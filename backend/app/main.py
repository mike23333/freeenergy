"""
Bedini Bot Backend API
FastAPI service for syncing YouTube transcripts and querying Vertex AI Search.
"""

from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional

from .config import get_settings
from .sync_engine import SyncEngine, list_channel_videos, test_transcript

app = FastAPI(
    title="Bedini Bot API",
    description="Backend service for the Bedini Answer Engine",
    version="1.0.0"
)

# CORS middleware for frontend access
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Configure appropriately for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class SyncRequest(BaseModel):
    limit: Optional[int] = None
    force: bool = False


class VideoSyncRequest(BaseModel):
    video_id: str
    title: str = "Unknown"


@app.get("/health")
async def health_check():
    """Health check endpoint for Cloud Run."""
    return {"status": "healthy", "service": "bedini-bot-backend"}


@app.get("/")
async def root():
    """Root endpoint with API info."""
    settings = get_settings()
    return {
        "service": "Bedini Bot Backend",
        "version": "1.0.0",
        "channel": settings.youtube_channel_handle,
        "datastore": settings.datastore_id
    }


@app.get("/videos")
async def get_videos(limit: int = 20):
    """List videos from Spencer's channel."""
    try:
        videos = list_channel_videos(limit=limit)
        return {"videos": videos, "count": len(videos)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/videos/{video_id}/transcript")
async def get_transcript(video_id: str):
    """Test if a video has an available transcript."""
    transcript = test_transcript(video_id)
    if transcript:
        return {
            "video_id": video_id,
            "has_transcript": True,
            "segment_count": len(transcript),
            "preview": transcript[:3] if transcript else []
        }
    return {
        "video_id": video_id,
        "has_transcript": False
    }


@app.post("/sync")
async def sync_channel(request: SyncRequest, background_tasks: BackgroundTasks):
    """
    Sync new videos from the channel.
    For large syncs, consider running in background.
    """
    try:
        engine = SyncEngine()
        results = engine.sync_channel(limit=request.limit, force=request.force)
        return results
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/sync/video")
async def sync_single_video(request: VideoSyncRequest):
    """Sync a single video by ID."""
    try:
        engine = SyncEngine()
        gcs_uri = engine.sync_video(request.video_id, request.title)
        if gcs_uri:
            return {
                "success": True,
                "video_id": request.video_id,
                "gcs_uri": gcs_uri
            }
        return {
            "success": False,
            "video_id": request.video_id,
            "error": "No transcript available"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/sync/status")
async def get_sync_status():
    """Get current sync status and processed video count."""
    try:
        engine = SyncEngine()
        processed = engine.get_processed_videos()
        return {
            "processed_count": len(processed),
            "processed_video_ids": list(processed)[:20]  # Show first 20
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
