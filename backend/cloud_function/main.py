"""
Cloud Function to fetch YouTube transcripts.
Runs from GCP infrastructure to avoid IP blocking.
"""

import json
import functions_framework
from youtube_transcript_api import YouTubeTranscriptApi


@functions_framework.http
def fetch_transcript(request):
    """
    HTTP Cloud Function to fetch YouTube transcript.

    Query params:
        video_id: YouTube video ID

    Returns:
        JSON array of transcript entries with text, start, duration
    """
    # Handle CORS
    if request.method == 'OPTIONS':
        headers = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Max-Age': '3600'
        }
        return ('', 204, headers)

    headers = {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
    }

    # Get video_id from query params or JSON body
    video_id = request.args.get('video_id')
    if not video_id and request.is_json:
        data = request.get_json()
        video_id = data.get('video_id')

    if not video_id:
        return (json.dumps({'error': 'video_id is required'}), 400, headers)

    try:
        # Use the newer API - instantiate and fetch
        ytt = YouTubeTranscriptApi()
        transcript = ytt.fetch(video_id)

        # Format response
        result = [{
            'text': entry.text,
            'start': entry.start,
            'duration': entry.duration
        } for entry in transcript]

        return (json.dumps({
            'video_id': video_id,
            'transcript': result
        }), 200, headers)

    except Exception as e:
        error_msg = str(e)
        if 'disabled' in error_msg.lower():
            return (json.dumps({
                'error': 'Transcripts are disabled for this video',
                'video_id': video_id
            }), 404, headers)
        elif 'not found' in error_msg.lower() or 'no transcript' in error_msg.lower():
            return (json.dumps({
                'error': 'No transcript found for this video',
                'video_id': video_id
            }), 404, headers)
        else:
            return (json.dumps({
                'error': error_msg,
                'video_id': video_id
            }), 500, headers)


@functions_framework.http
def fetch_batch_transcripts(request):
    """
    Fetch transcripts for multiple videos.

    POST body:
        video_ids: List of YouTube video IDs

    Returns:
        JSON object with results for each video
    """
    headers = {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
    }

    if request.method == 'OPTIONS':
        headers['Access-Control-Allow-Methods'] = 'POST'
        headers['Access-Control-Allow-Headers'] = 'Content-Type'
        return ('', 204, headers)

    if not request.is_json:
        return (json.dumps({'error': 'JSON body required'}), 400, headers)

    data = request.get_json()
    video_ids = data.get('video_ids', [])

    if not video_ids:
        return (json.dumps({'error': 'video_ids array is required'}), 400, headers)

    ytt = YouTubeTranscriptApi()
    results = {}

    for video_id in video_ids:
        try:
            transcript = ytt.fetch(video_id)

            results[video_id] = {
                'success': True,
                'transcript': [{
                    'text': entry.text,
                    'start': entry.start,
                    'duration': entry.duration
                } for entry in transcript]
            }

        except Exception as e:
            results[video_id] = {
                'success': False,
                'error': str(e)
            }

    return (json.dumps(results), 200, headers)
