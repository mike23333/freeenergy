'use client'

import { useCallback,useState } from 'react'

import {
  AlertCircle,
  CheckCircle,
  File,
  FileText,
  Loader2,
  Upload,
  X} from 'lucide-react'

import type { DocumentUploadResponse } from '@/lib/types/documents'
import { cn } from '@/lib/utils'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

interface DocumentUploadProps {
  onUploadComplete?: (result: {
    document_id: string
    filename: string
    chunks_created: number
  }) => void
}

interface UploadState {
  status: 'idle' | 'uploading' | 'success' | 'error'
  filename?: string
  error?: string
  result?: {
    document_id: string
    chunks_created: number
  }
}

const ACCEPTED_EXTENSIONS = ['.pdf', '.docx']
const MAX_FILE_SIZE_MB = 50

export function DocumentUpload({ onUploadComplete }: DocumentUploadProps) {
  const [uploadState, setUploadState] = useState<UploadState>({
    status: 'idle'
  })
  const [isDragging, setIsDragging] = useState(false)

  const validateFile = (file: File): string | null => {
    // Check file extension
    const extension = '.' + file.name.split('.').pop()?.toLowerCase()
    if (!ACCEPTED_EXTENSIONS.includes(extension)) {
      return 'Invalid file type. Please upload PDF or DOCX files.'
    }

    // Check file size
    if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
      return `File too large. Maximum size is ${MAX_FILE_SIZE_MB}MB.`
    }

    return null
  }

  const handleFile = useCallback(
    async (file: File) => {
      const validationError = validateFile(file)
      if (validationError) {
        setUploadState({
          status: 'error',
          filename: file.name,
          error: validationError
        })
        return
      }

      setUploadState({
        status: 'uploading',
        filename: file.name
      })

      try {
        const formData = new FormData()
        formData.append('file', file)

        const response = await fetch('/api/upload-document', {
          method: 'POST',
          body: formData
        })

        if (!response.ok) {
          const errorData = await response.json()
          throw new Error(errorData.error || 'Upload failed')
        }

        const result: DocumentUploadResponse = await response.json()

        setUploadState({
          status: 'success',
          filename: file.name,
          result: {
            document_id: result.document_id,
            chunks_created: result.chunks_created
          }
        })

        onUploadComplete?.({
          document_id: result.document_id,
          filename: file.name,
          chunks_created: result.chunks_created
        })
      } catch (error) {
        setUploadState({
          status: 'error',
          filename: file.name,
          error: error instanceof Error ? error.message : 'Upload failed'
        })
      }
    },
    [onUploadComplete]
  )

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragging(false)

      const file = e.dataTransfer.files[0]
      if (file) handleFile(file)
    },
    [handleFile]
  )

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback(() => {
    setIsDragging(false)
  }, [])

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (file) handleFile(file)
    },
    [handleFile]
  )

  const resetUpload = useCallback(() => {
    setUploadState({ status: 'idle' })
  }, [])

  const getFileIcon = (filename?: string) => {
    if (filename?.toLowerCase().endsWith('.pdf'))
      return <FileText className="h-8 w-8 text-red-500" />
    if (filename?.toLowerCase().endsWith('.docx'))
      return <File className="h-8 w-8 text-blue-500" />
    return <Upload className="h-8 w-8 text-muted-foreground" />
  }

  return (
    <Card
      className={cn(
        'border-2 border-dashed transition-colors',
        isDragging && 'border-primary bg-primary/5',
        uploadState.status === 'success' &&
          'border-green-500 bg-green-50 dark:bg-green-950/20',
        uploadState.status === 'error' && 'border-destructive bg-destructive/5'
      )}
    >
      <CardContent
        className="p-6"
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
      >
        {uploadState.status === 'idle' && (
          <label className="flex cursor-pointer flex-col items-center gap-4">
            <Upload className="h-12 w-12 text-muted-foreground" />
            <div className="text-center">
              <p className="font-medium">
                Drop a document here or click to upload
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                PDF or Word documents (max {MAX_FILE_SIZE_MB}MB)
              </p>
            </div>
            <input
              type="file"
              accept=".pdf,.docx"
              className="hidden"
              onChange={handleInputChange}
            />
          </label>
        )}

        {uploadState.status === 'uploading' && (
          <div className="flex flex-col items-center gap-4">
            {getFileIcon(uploadState.filename)}
            <div className="text-center">
              <p className="flex items-center gap-2 font-medium">
                <Loader2 className="h-4 w-4 animate-spin" />
                Uploading {uploadState.filename}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Processing document...
              </p>
            </div>
          </div>
        )}

        {uploadState.status === 'success' && (
          <div className="flex flex-col items-center gap-4">
            <CheckCircle className="h-12 w-12 text-green-500" />
            <div className="text-center">
              <p className="font-medium text-green-700 dark:text-green-400">
                {uploadState.filename} uploaded successfully
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Created {uploadState.result?.chunks_created} searchable chunks
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={resetUpload}>
              Upload Another
            </Button>
          </div>
        )}

        {uploadState.status === 'error' && (
          <div className="flex flex-col items-center gap-4">
            <AlertCircle className="h-12 w-12 text-destructive" />
            <div className="text-center">
              <p className="font-medium text-destructive">Upload failed</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {uploadState.error}
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={resetUpload}>
              <X className="mr-2 h-4 w-4" />
              Try Again
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
