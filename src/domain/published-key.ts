/**
 * Files a job publishes sit side by side under one folder. This is the one rule for "the key of a sibling file":
 * the runner uses it when it stores each output, and anything that reads a published file back uses it too.
 */
export function siblingKey(publishedKey: string, fileName: string): string {
  return publishedKey.slice(0, publishedKey.lastIndexOf("/") + 1) + fileName;
}
