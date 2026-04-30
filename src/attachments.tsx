import {
  IconFileCode,
  IconFileMusic,
  IconFileSpreadsheet,
  IconFileText,
  IconFileTypePdf,
  IconFileTypeZip,
  IconFileUnknown,
  IconPhoto,
  IconVideo,
} from '@tabler/icons-react'
import type { AttachmentData, AttachmentPayload } from './types'

export function attachmentIcon(attachment: AttachmentPayload) {
  const extension = attachment.fileName.split('.').pop()?.toLowerCase() ?? ''
  const mimeType = attachment.mimeType.toLowerCase()
  const size = 16

  if (mimeType.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'svg', 'webp'].includes(extension)) {
    return <IconPhoto size={size} />
  }

  if (mimeType === 'application/pdf' || extension === 'pdf') {
    return <IconFileTypePdf size={size} />
  }

  if (
    mimeType.startsWith('text/') ||
    ['txt', 'md', 'rtf', 'doc', 'docx'].includes(extension)
  ) {
    return <IconFileText size={size} />
  }

  if (
    mimeType.includes('sheet') ||
    mimeType.includes('excel') ||
    ['csv', 'xls', 'xlsx'].includes(extension)
  ) {
    return <IconFileSpreadsheet size={size} />
  }

  if (
    mimeType.includes('zip') ||
    mimeType.includes('compressed') ||
    ['zip', 'rar', '7z', 'tar', 'gz'].includes(extension)
  ) {
    return <IconFileTypeZip size={size} />
  }

  if (
    mimeType.startsWith('audio/') ||
    ['mp3', 'wav', 'aac', 'ogg', 'flac', 'm4a'].includes(extension)
  ) {
    return <IconFileMusic size={size} />
  }

  if (
    mimeType.startsWith('video/') ||
    ['mp4', 'mov', 'avi', 'mkv', 'webm'].includes(extension)
  ) {
    return <IconVideo size={size} />
  }

  if (
    mimeType.includes('json') ||
    mimeType.includes('xml') ||
    mimeType.includes('javascript') ||
    mimeType.includes('typescript') ||
    ['json', 'xml', 'js', 'jsx', 'ts', 'tsx', 'rs', 'py', 'java', 'c', 'cpp', 'html', 'css'].includes(extension)
  ) {
    return <IconFileCode size={size} />
  }

  return <IconFileUnknown size={size} />
}

export function downloadAttachment(attachment: AttachmentData) {
  const binary = atob(attachment.base64Data)
  const bytes = new Uint8Array(binary.length)

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }

  const blob = new Blob([bytes], {
    type: attachment.mimeType || 'application/octet-stream',
  })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = attachment.fileName
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

export async function fileToAttachment(file: File): Promise<AttachmentPayload> {
  const buffer = await file.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  let binary = ''

  const chunkSize = 0x8000
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize)
    binary += String.fromCharCode(...chunk)
  }

  return {
    id: crypto.randomUUID(),
    fileName: file.name,
    mimeType: file.type || 'application/octet-stream',
    sizeBytes: file.size,
    base64Data: btoa(binary),
  }
}

export function mergeAttachments(
  existing: AttachmentPayload[],
  nextAttachments: AttachmentPayload[],
  subject: 'record' | 'comment',
) {
  if (existing.length + nextAttachments.length > 10) {
    return {
      attachments: existing,
      error: `You can attach up to 10 files per ${subject}.`,
    }
  }

  const deduped = nextAttachments.filter(
    (attachment) =>
      !existing.some(
        (current) =>
          current.fileName === attachment.fileName &&
          current.sizeBytes === attachment.sizeBytes &&
          current.base64Data === attachment.base64Data,
      ),
  )

  return {
    attachments: [...existing, ...deduped],
    error: null,
  }
}

export function previewAttachmentKind(attachment: AttachmentPayload) {
  const mimeType = attachment.mimeType.toLowerCase()
  const extension = attachment.fileName.split('.').pop()?.toLowerCase() ?? ''

  if (mimeType.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg'].includes(extension)) {
    return 'image'
  }

  if (mimeType === 'application/pdf' || extension === 'pdf') {
    return 'pdf'
  }

  if (
    mimeType.startsWith('text/') ||
    mimeType.includes('json') ||
    mimeType.includes('xml') ||
    ['txt', 'md', 'json', 'xml', 'csv', 'ts', 'tsx', 'js', 'jsx', 'css', 'html'].includes(extension)
  ) {
    return 'text'
  }

  return null
}

export function attachmentPreviewData(
  attachment: AttachmentPayload,
  data?: AttachmentData | null,
) {
  const previewKind = previewAttachmentKind(attachment)
  const base64Data = data?.base64Data ?? attachment.base64Data
  if (!base64Data) {
    return null
  }

  if (previewKind === 'image' || previewKind === 'pdf') {
    return `data:${attachment.mimeType};base64,${base64Data}`
  }

  if (previewKind === 'text') {
    return atob(base64Data)
  }

  return null
}
