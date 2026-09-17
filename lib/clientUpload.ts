"use client";

import { upload } from '@vercel/blob/client';
import type { UploadedFile } from '@/lib/blobUpload';

/**
 * Browser-side file picking + Blob upload, shared by the print-order and
 * fax-request forms.
 *
 * Files go straight from the browser to Vercel Blob (multipart/chunked, so large
 * scans are reliable), and only the resulting URLs are posted to our own API —
 * which is what keeps both forms clear of the ~4.5 MB serverless body limit.
 *
 * Server counterpart: lib/blobUpload.ts.
 */

export const DOC_EXTENSIONS = ['.pdf', '.doc', '.docx'];
export const PDF_EXTENSIONS = ['.pdf'];

/** `accept` attribute for a document file input. */
export const DOC_ACCEPT =
  '.pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const PDF_ACCEPT = '.pdf,application/pdf';

/**
 * Reject anything that isn't an allowed extension, returning the offending file
 * name so the caller can name it in the error. Extension-only by design: the
 * authoritative content-type check happens server-side when the token is minted.
 */
export function findDisallowedFile(files: File[], allowedExt: string[]): File | undefined {
  return files.find((f) => !allowedExt.some((ext) => f.name.toLowerCase().endsWith(ext)));
}

export interface UploadOptions {
  /** The token-minting endpoint (e.g. /api/print-order/upload). */
  handleUploadUrl: string;
  /** Called before each file so the form can show "Uploading 2 of 3: …". */
  onProgress?: (message: string) => void;
}

/**
 * Upload each file to Blob in turn and return the references to post to our API.
 *
 * Sequential rather than parallel on purpose: a counter customer on shop wifi
 * uploading a stack of scans gets a progress message that means something, and
 * one failure doesn't leave several half-finished uploads behind.
 */
export async function uploadDocuments(
  files: File[],
  { handleUploadUrl, onProgress }: UploadOptions
): Promise<UploadedFile[]> {
  const uploaded: UploadedFile[] = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    onProgress?.(`Uploading ${i + 1} of ${files.length}: ${file.name}`);
    const blob = await upload(file.name, file, {
      access: 'public',
      handleUploadUrl,
      multipart: true, // chunked upload — reliable for large files
    });
    uploaded.push({ name: file.name, url: blob.url, size: file.size });
  }
  return uploaded;
}
