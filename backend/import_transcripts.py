#!/usr/bin/env python3
"""Import transcripts from Spencer's YouTube channel into Vertex AI Search."""

import scrapetube
import json
import base64
import subprocess
import requests
from youtube_transcript_api import YouTubeTranscriptApi

# Get 5 videos from Spencer's channel
print("Fetching videos from @MadscienceLPTECH...")
videos = list(scrapetube.get_channel(
    channel_url="https://www.youtube.com/@MadscienceLPTECH",
    limit=5
))

ytt = YouTubeTranscriptApi()

# Get access token
print("Getting access token...")
token = subprocess.check_output(["gcloud", "auth", "print-access-token"]).decode().strip()

BASE = "https://discoveryengine.googleapis.com/v1/projects/bedini-answer-bot/locations/global/collections/default_collection/dataStores/spencer-transcripts/branches/default_branch/documents"

doc_count = 0
processed_videos = []

for v in videos:
    video_id = v["videoId"]
    title = v.get("title", {}).get("runs", [{}])[0].get("text", "Unknown")

    print(f"\nProcessing: {title}")
    print(f"  URL: https://youtube.com/watch?v={video_id}")

    try:
        transcript = ytt.fetch(video_id)
        print(f"  Got {len(transcript)} entries")

        # Create chunks of ~400 chars
        current_text = ""
        chunk_start = 0
        chunk_num = 0

        for entry in transcript:
            current_text += " " + entry.text

            if len(current_text) >= 400:
                chunk_end = entry.start + entry.duration
                doc_id = f"{video_id}_{chunk_num}"

                # Create document
                doc = {
                    "id": doc_id,
                    "structData": {
                        "video_id": video_id,
                        "title": title,
                        "timestamp_start": int(chunk_start),
                        "timestamp_end": int(chunk_end),
                        "channel": "@MadscienceLPTECH",
                        "youtube_url": f"https://youtube.com/watch?v={video_id}&t={int(chunk_start)}s",
                        "transcript": current_text.strip()
                    },
                    "content": {
                        "mimeType": "text/plain",
                        "rawBytes": base64.b64encode(current_text.strip().encode()).decode()
                    }
                }

                # Upload to Vertex AI
                resp = requests.patch(
                    f"{BASE}/{doc_id}?allowMissing=true",
                    headers={
                        "Authorization": f"Bearer {token}",
                        "Content-Type": "application/json",
                        "X-Goog-User-Project": "bedini-answer-bot"
                    },
                    json=doc
                )

                if resp.status_code == 200:
                    doc_count += 1
                else:
                    print(f"  ERROR uploading {doc_id}: {resp.text[:100]}")

                # Reset for next chunk
                chunk_start = entry.start + entry.duration
                current_text = ""
                chunk_num += 1

        # Handle remaining text
        if current_text.strip():
            doc_id = f"{video_id}_{chunk_num}"
            doc = {
                "id": doc_id,
                "structData": {
                    "video_id": video_id,
                    "title": title,
                    "timestamp_start": int(chunk_start),
                    "timestamp_end": int(transcript[-1].start + transcript[-1].duration),
                    "channel": "@MadscienceLPTECH",
                    "youtube_url": f"https://youtube.com/watch?v={video_id}&t={int(chunk_start)}s",
                    "transcript": current_text.strip()
                },
                "content": {
                    "mimeType": "text/plain",
                    "rawBytes": base64.b64encode(current_text.strip().encode()).decode()
                }
            }

            resp = requests.patch(
                f"{BASE}/{doc_id}?allowMissing=true",
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                    "X-Goog-User-Project": "bedini-answer-bot"
                },
                json=doc
            )

            if resp.status_code == 200:
                doc_count += 1
            chunk_num += 1

        print(f"  Created {chunk_num} chunks")
        processed_videos.append({
            "title": title,
            "url": f"https://youtube.com/watch?v={video_id}",
            "chunks": chunk_num
        })

    except Exception as e:
        print(f"  ERROR: {e}")

print(f"\n{'='*50}")
print(f"Total documents created: {doc_count}")
print(f"\nProcessed videos:")
for pv in processed_videos:
    print(f"  - {pv['title']}")
    print(f"    {pv['url']} ({pv['chunks']} chunks)")
