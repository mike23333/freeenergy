# Indexed Videos - Energy Search

Last updated: 2026-01-01

## Summary
- **Total Videos**: 5
- **Total Document Chunks**: 339
- **Channel**: @MadscienceLPTECH (Spencer's Limitless Potential Technologies)

## Indexed Videos

| # | Title | Video ID | URL | Chunks |
|---|-------|----------|-----|--------|
| 1 | The Device That Could Power The World - In My Garage | YAkkdGXs40c | https://youtube.com/watch?v=YAkkdGXs40c | 66 |
| 2 | I Built a Machine They Said Was Impossible | 6Nxb3h2zd20 | https://youtube.com/watch?v=6Nxb3h2zd20 | 63 |
| 3 | The Device That Could Give The World Unlimited Energy | XsueZ_eFRC4 | https://youtube.com/watch?v=XsueZ_eFRC4 | 85 |
| 4 | Building the Unthinkable in My Garage | qto0KTJ2WAs | https://youtube.com/watch?v=qto0KTJ2WAs | 70 |
| 5 | This Clean Energy Breakthrough Is Happening in My Garage | MtaA5NxvnRY | https://youtube.com/watch?v=MtaA5NxvnRY | 55 |

## Technical Details

- **Datastore**: `spencer-transcripts`
- **GCP Project**: `bedini-answer-bot`
- **Chunk Size**: ~400 characters per chunk
- **Each chunk includes**: transcript text, video title, timestamp start/end, YouTube URL with timestamp

## Adding More Videos

To add more videos, run:
```bash
cd /home/michael/Documents/freeenergysearchAI/backend
source venv/bin/activate
python3 import_transcripts.py
```

Note: Requires VPN if YouTube is blocking your IP.
