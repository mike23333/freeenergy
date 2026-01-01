"""
YouTube Transcript Sync Engine
Fetches transcripts from Spencer's channel and uploads to GCS in JSONL format.
"""

import json
import logging
from typing import Optional
from datetime import datetime

import scrapetube
from youtube_transcript_api import YouTubeTranscriptApi
from youtube_transcript_api.formatters import JSONFormatter
from google.cloud import storage
from google.cloud import firestore

from .config import get_settings

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class SyncEngine:
    def __init__(self):
        self.settings = get_settings()
        self.ytt_api = YouTubeTranscriptApi()
        self.storage_client = storage.Client(project=self.settings.gcp_project_id)
        self.bucket = self.storage_client.bucket(self.settings.gcs_bucket)
        self.db = firestore.Client(project=self.settings.gcp_project_id)

    def get_processed_videos(self) -> set:
        """Get set of already processed video IDs from Firestore."""
        doc_ref = self.db.collection("sync_state").document("last_sync")
        doc = doc_ref.get()
        if doc.exists:
            return set(doc.to_dict().get("processed_video_ids", []))
        return set()

    def save_processed_videos(self, video_ids: set):
        """Save processed video IDs to Firestore."""
        doc_ref = self.db.collection("sync_state").document("last_sync")
        doc_ref.set({
            "processed_video_ids": list(video_ids),
            "last_updated": datetime.utcnow().isoformat()
        })

    def get_channel_videos(self, limit: Optional[int] = None) -> list:
        """Fetch video metadata from the YouTube channel."""
        logger.info(f"Fetching videos from channel: {self.settings.youtube_channel_handle}")

        videos = []
        for video in scrapetube.get_channel(
            channel_url=f"https://www.youtube.com/{self.settings.youtube_channel_handle}",
            limit=limit
        ):
            videos.append({
                "video_id": video["videoId"],
                "title": video.get("title", {}).get("runs", [{}])[0].get("text", "Unknown"),
                "thumbnail": video.get("thumbnail", {}).get("thumbnails", [{}])[-1].get("url", ""),
                "published": video.get("publishedTimeText", {}).get("simpleText", ""),
            })

        logger.info(f"Found {len(videos)} videos")
        return videos

    def fetch_transcript(self, video_id: str) -> Optional[list]:
        """Fetch transcript for a single video with 1-second precision."""
        try:
            transcript = self.ytt_api.fetch(video_id)
            return [
                {
                    "text": entry.text,
                    "start": entry.start,
                    "duration": entry.duration
                }
                for entry in transcript
            ]
        except Exception as e:
            logger.warning(f"Could not fetch transcript for {video_id}: {e}")
            return None

    def create_jsonl_document(self, video_id: str, title: str, transcript: list) -> list:
        """
        Create JSONL documents for Vertex AI Search.
        Each transcript segment becomes a separate document with metadata.
        """
        documents = []

        # Create chunks of transcript segments (roughly 500 chars each)
        current_chunk = []
        current_text = ""
        chunk_start = 0

        for entry in transcript:
            current_chunk.append(entry)
            current_text += " " + entry["text"]

            if len(current_text) >= 400:  # Chunk at ~400 chars
                chunk_end = entry["start"] + entry["duration"]
                doc = {
                    "id": f"{video_id}_{int(chunk_start)}",
                    "structData": {
                        "video_id": video_id,
                        "title": title,
                        "timestamp_start": int(chunk_start),
                        "timestamp_end": int(chunk_end),
                        "channel": self.settings.youtube_channel_handle,
                        "youtube_url": f"https://youtube.com/watch?v={video_id}&t={int(chunk_start)}s"
                    },
                    "content": {
                        "mimeType": "text/plain",
                        "rawBytes": current_text.strip()
                    }
                }
                documents.append(doc)

                # Reset for next chunk
                chunk_start = entry["start"] + entry["duration"]
                current_chunk = []
                current_text = ""

        # Handle remaining content
        if current_text.strip():
            doc = {
                "id": f"{video_id}_{int(chunk_start)}",
                "structData": {
                    "video_id": video_id,
                    "title": title,
                    "timestamp_start": int(chunk_start),
                    "timestamp_end": int(transcript[-1]["start"] + transcript[-1]["duration"]),
                    "channel": self.settings.youtube_channel_handle,
                    "youtube_url": f"https://youtube.com/watch?v={video_id}&t={int(chunk_start)}s"
                },
                "content": {
                    "mimeType": "text/plain",
                    "rawBytes": current_text.strip()
                }
            }
            documents.append(doc)

        return documents

    def upload_to_gcs(self, video_id: str, documents: list) -> str:
        """Upload JSONL documents to Cloud Storage."""
        blob_path = f"{self.settings.transcripts_prefix}/{video_id}.jsonl"
        blob = self.bucket.blob(blob_path)

        jsonl_content = "\n".join(json.dumps(doc) for doc in documents)
        blob.upload_from_string(jsonl_content, content_type="application/jsonl")

        gcs_uri = f"gs://{self.settings.gcs_bucket}/{blob_path}"
        logger.info(f"Uploaded transcript to {gcs_uri}")
        return gcs_uri

    def sync_video(self, video_id: str, title: str) -> Optional[str]:
        """Sync a single video: fetch transcript, create JSONL, upload to GCS."""
        logger.info(f"Syncing video: {title} ({video_id})")

        transcript = self.fetch_transcript(video_id)
        if not transcript:
            return None

        documents = self.create_jsonl_document(video_id, title, transcript)
        gcs_uri = self.upload_to_gcs(video_id, documents)

        return gcs_uri

    def sync_channel(self, limit: Optional[int] = None, force: bool = False) -> dict:
        """
        Sync all new videos from the channel.

        Args:
            limit: Maximum number of videos to fetch from channel
            force: If True, re-sync already processed videos

        Returns:
            Summary of sync operation
        """
        processed = set() if force else self.get_processed_videos()
        videos = self.get_channel_videos(limit=limit)

        results = {
            "total_videos": len(videos),
            "already_processed": 0,
            "synced": [],
            "failed": [],
            "no_transcript": []
        }

        for video in videos:
            video_id = video["video_id"]
            title = video["title"]

            if video_id in processed:
                results["already_processed"] += 1
                continue

            gcs_uri = self.sync_video(video_id, title)

            if gcs_uri:
                results["synced"].append({
                    "video_id": video_id,
                    "title": title,
                    "gcs_uri": gcs_uri
                })
                processed.add(video_id)
            else:
                results["no_transcript"].append({
                    "video_id": video_id,
                    "title": title
                })

        # Save updated processed list
        if results["synced"]:
            self.save_processed_videos(processed)

        return results


def list_channel_videos(limit: int = 10) -> list:
    """Helper function to list videos from the channel."""
    engine = SyncEngine()
    return engine.get_channel_videos(limit=limit)


def test_transcript(video_id: str) -> Optional[list]:
    """Helper function to test if a video has an available transcript."""
    engine = SyncEngine()
    return engine.fetch_transcript(video_id)
