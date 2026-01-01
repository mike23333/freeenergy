Project: Bedini-Bot Answer Engine
Objective: Build a high-performance, grounded AI answer engine using Spencer’s "Limitless Potential Technologies" YouTube channel and technical documents.
1. Core Tech Stack
Frontend: Morphic AI Answer Engine (Next.js 15+, Tailwind CSS, Vercel AI SDK). here’s the link: https://github.com/miurla/morphic  
AI Model: Gemini 3.0 Flash via Google Gen AI SDK.
Knowledge Base: Vertex AI Search (Unstructured Data Store).
Backend: Python (FastAPI) deployed on Google Cloud Run.
Database/Storage: Google Cloud Storage (for JSONL files) and Firestore (for sync state).

2. The Data Pipeline (Python Sync Engine)
The developer needs to deploy a script that runs every 24 hours to keep the bot updated.
Task: Scrape YouTube transcripts with 1-second precision.
Format: Output to JSONL (metadata-rich format for Vertex AI).
Logic: 1. Check last_sync.json for processed Video IDs. 2. Fetch new transcripts using youtube-transcript-api. 3. Upload to gs://spencer-knowledge-vault/. 4. Trigger Vertex AI Search "Import" to refresh the index.

3. Vertex AI Search Grounding Configuration
The developer must configure the "Unstructured Data Store" in the Google Cloud Console.
Grounding Source: Vertex AI Search.
Metadata Mapping: Ensure the video_id and timestamp fields are indexed.
Gemini 3.0 Integration: Use the Google Search_retrieval tool pointing to the datastore_id.

4. Morphic Frontend Integration (Generative UI)
Modify the Morphic template to handle "Source Cards" instead of just text links.
Answer Layout: 1. Sources Grid: Top of the response shows a horizontal scroll of videos/docs just like template does now.. 2. Answer Body: The AI-generated text using Gemini 3.0 Flash.
YouTube Deep Linking:
The component must parse the groundingMetadata.
Format: https://youtube.com/watch?v={video_id}&t={timestamp}s.
Styling: Use the default Morphic design (clean, modern, "answer engine" style). 
5. Senior Dev Cost/Performance Features
Tell the developer to implement these specifically:
Context Caching: Use Gemini 3.0’s caching for the core Bedini manuals and high-traffic video transcripts to reduce token costs by 75%.

Serverless Scaling: Deploy on Cloud Run with "min-instances: 0" to ensure Spencer only pays when people are actually using the bot.


Channel Information to get videos from.
YouTube Channel Name: Limitless Potential Technologies
Handle: @MadscienceLPTECH
Channel URL: https://www.youtube.com/@MadscienceLPTECH
Creator Name: Spencer
"Can you set up a Proof of Concept (POC) where the Morphic frontend pulls one grounded answer from a Vertex AI Search data store containing just 5 of Spencer's videos?"

