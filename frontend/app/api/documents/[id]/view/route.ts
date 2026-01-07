import { NextRequest, NextResponse } from 'next/server'

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const documentId = (await params).id
  if (!documentId) {
    return NextResponse.json({ error: 'Document ID is required' }, { status: 400 })
  }

  const { searchParams } = new URL(request.url)
  const page = searchParams.get('page') || '1'

  try {
    // Fetch signed URL from backend
    const response = await fetch(
      `${BACKEND_URL}/documents/${documentId}/signed-url?page=${page}`
    )

    if (!response.ok) {
      const errorText = await response.text()
      console.error('Backend error:', errorText)
      return NextResponse.json(
        { error: 'Failed to get document URL' },
        { status: response.status }
      )
    }

    const data = await response.json()

    // Redirect to the signed URL
    return NextResponse.redirect(data.url)
  } catch (error) {
    console.error('Error fetching signed URL:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
