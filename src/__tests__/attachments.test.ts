import { describe, it, expect } from 'vitest'
import { mergeAttachments, previewAttachmentKind, attachmentPreviewData } from '../attachments'
import type { AttachmentPayload } from '../types'

function makeAttachment(overrides: Partial<AttachmentPayload> = {}): AttachmentPayload {
  return {
    id: crypto.randomUUID(),
    fileName: 'file.txt',
    mimeType: 'text/plain',
    sizeBytes: 1024,
    base64Data: btoa('hello'),
    ...overrides,
  }
}

// ── mergeAttachments ──────────────────────────────────────────────────────────
describe('mergeAttachments', () => {
  it('merges new attachments into existing list', () => {
    const existing = [makeAttachment({ fileName: 'a.txt' })]
    const next = [makeAttachment({ fileName: 'b.txt' })]
    const result = mergeAttachments(existing, next, 'record')
    expect(result.error).toBeNull()
    expect(result.attachments).toHaveLength(2)
  })

  it('rejects files over 10 MB', () => {
    const bigFile = makeAttachment({ fileName: 'huge.bin', sizeBytes: 11 * 1024 * 1024 })
    const result = mergeAttachments([], [bigFile], 'record')
    expect(result.error).toContain('larger than the 10 MB per-file limit')
    expect(result.attachments).toHaveLength(0)
  })

  it('rejects when total would exceed 10 attachments', () => {
    const existing = Array.from({ length: 9 }, (_, i) =>
      makeAttachment({ fileName: `existing-${i}.txt` }),
    )
    const next = [
      makeAttachment({ fileName: 'new1.txt' }),
      makeAttachment({ fileName: 'new2.txt' }),
    ]
    const result = mergeAttachments(existing, next, 'record')
    expect(result.error).toContain('up to 10 files')
    expect(result.attachments).toHaveLength(9)
  })

  it('deduplicates attachments with same fileName, sizeBytes and base64Data', () => {
    const att = makeAttachment({ fileName: 'dup.txt', sizeBytes: 100, base64Data: btoa('abc') })
    const duplicate = { ...att, id: crypto.randomUUID() }
    const result = mergeAttachments([att], [duplicate], 'record')
    expect(result.error).toBeNull()
    expect(result.attachments).toHaveLength(1)
  })

  it('does not deduplicate attachments with different content', () => {
    const att1 = makeAttachment({ fileName: 'file.txt', base64Data: btoa('v1') })
    const att2 = makeAttachment({ fileName: 'file.txt', base64Data: btoa('v2') })
    const result = mergeAttachments([att1], [att2], 'record')
    expect(result.attachments).toHaveLength(2)
  })

  it('uses "comment" subject in error messages when applicable', () => {
    const existing = Array.from({ length: 10 }, (_, i) =>
      makeAttachment({ fileName: `existing-${i}.txt` }),
    )
    const result = mergeAttachments(existing, [makeAttachment()], 'comment')
    expect(result.error).toContain('comment')
  })
})

// ── previewAttachmentKind ─────────────────────────────────────────────────────
describe('previewAttachmentKind', () => {
  it.each([
    ['image/png', 'photo.png', 'image'],
    ['image/jpeg', 'photo.jpg', 'image'],
    ['image/gif', 'anim.gif', 'image'],
    ['image/webp', 'img.webp', 'image'],
    ['application/octet-stream', 'icon.svg', 'image'],
  ])('detects image: mimeType=%s, fileName=%s', (mimeType, fileName, expected) => {
    expect(previewAttachmentKind(makeAttachment({ mimeType, fileName }))).toBe(expected)
  })

  it.each([
    ['application/pdf', 'doc.pdf', 'pdf'],
    ['application/octet-stream', 'doc.pdf', 'pdf'],
  ])('detects PDF: mimeType=%s, fileName=%s', (mimeType, fileName, expected) => {
    expect(previewAttachmentKind(makeAttachment({ mimeType, fileName }))).toBe(expected)
  })

  it.each([
    ['text/plain', 'readme.txt', 'text'],
    ['text/markdown', 'notes.md', 'text'],
    ['application/json', 'data.json', 'text'],
    ['application/octet-stream', 'config.json', 'text'],
    ['application/octet-stream', 'styles.css', 'text'],
    ['application/octet-stream', 'data.csv', 'text'],
  ])('detects text: mimeType=%s, fileName=%s', (mimeType, fileName, expected) => {
    expect(previewAttachmentKind(makeAttachment({ mimeType, fileName }))).toBe(expected)
  })

  it.each([
    ['application/zip', 'archive.zip', null],
    ['audio/mp3', 'song.mp3', null],
    ['video/mp4', 'clip.mp4', null],
    ['application/octet-stream', 'data.bin', null],
  ])('returns null for non-previewable: mimeType=%s, fileName=%s', (mimeType, fileName, expected) => {
    expect(previewAttachmentKind(makeAttachment({ mimeType, fileName }))).toBe(expected)
  })
})

// ── attachmentPreviewData ─────────────────────────────────────────────────────
describe('attachmentPreviewData', () => {
  it('returns data URI for image attachments', () => {
    const att = makeAttachment({
      mimeType: 'image/png',
      fileName: 'img.png',
      base64Data: btoa('fake-png-data'),
    })
    const result = attachmentPreviewData(att)
    expect(result).toMatch(/^data:image\/png;base64,/)
  })

  it('returns data URI for PDF attachments', () => {
    const att = makeAttachment({
      mimeType: 'application/pdf',
      fileName: 'doc.pdf',
      base64Data: btoa('fake-pdf'),
    })
    const result = attachmentPreviewData(att)
    expect(result).toMatch(/^data:application\/pdf;base64,/)
  })

  it('returns decoded string for text attachments', () => {
    const content = 'Hello world!'
    const att = makeAttachment({
      mimeType: 'text/plain',
      fileName: 'note.txt',
      base64Data: btoa(content),
    })
    const result = attachmentPreviewData(att)
    expect(result).toBe(content)
  })

  it('returns null when no base64Data is present', () => {
    const att = makeAttachment({ mimeType: 'image/png', fileName: 'img.png', base64Data: undefined })
    expect(attachmentPreviewData(att)).toBeNull()
  })

  it('returns null for non-previewable types', () => {
    const att = makeAttachment({ mimeType: 'application/zip', fileName: 'archive.zip' })
    expect(attachmentPreviewData(att)).toBeNull()
  })

  it('prefers data passed as second argument over attachment.base64Data', () => {
    const att = makeAttachment({
      mimeType: 'text/plain',
      fileName: 'note.txt',
      base64Data: btoa('old'),
    })
    const data = { ...att, base64Data: btoa('new') }
    expect(attachmentPreviewData(att, data)).toBe('new')
  })
})
