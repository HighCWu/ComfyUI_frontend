import {
  zMoveUserdataFileResponse,
  zPostUserdataFileResponse
} from '@comfyorg/ingest-types/zod'
import { defineStore } from 'pinia'
import { computed, ref, toRaw } from 'vue'
import { z } from 'zod'
import type { ZodType } from 'zod'

import { reportError } from '@/platform/telemetry/reportError'
import { api } from '@/scripts/api'
import type { TreeExplorerNode } from '@/types/treeExplorerTypes'
import { getPathDetails } from '@/utils/formatUtil'
import { syncEntities } from '@/utils/syncUtil'
import { buildTree } from '@/utils/treeUtil'

const remoteFileValidators = new WeakMap<UserFile, string>()
const storedUserDataResponseSchema = zPostUserdataFileResponse.extend({
  modified: z.number(),
  size: z.number()
})
const movedUserDataResponseSchema = zMoveUserdataFileResponse.extend({
  modified: z.number(),
  size: z.number()
})
type UserDataMutationResponse = z.output<typeof storedUserDataResponseSchema>

async function readUserDataMutationResponse(
  response: Response,
  schema: ZodType<UserDataMutationResponse>,
  operation: 'save' | 'rename'
): Promise<UserDataMutationResponse | undefined> {
  let raw: unknown
  try {
    raw = await response.json()
  } catch (cause) {
    reportError(cause, {
      errorType: 'userdata_mutation_invalid_response',
      surface: 'platform',
      tags: { operation, status: response.status }
    })
    return undefined
  }
  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    reportError(parsed.error, {
      errorType: 'userdata_mutation_invalid_response',
      surface: 'platform',
      tags: { operation, status: response.status }
    })
    return undefined
  }
  return parsed.data
}

export async function refreshNativeFileValidator(
  file: UserFile,
  path: string,
  expectedContent: string
): Promise<boolean> {
  const expected = canonicalFileJson(expectedContent)
  if (file.path !== path || expected === undefined) return false
  const response = await api.getUserData(path)
  if (!response.ok || !isNativeFileValidator(response.headers.get('ETag'))) {
    await response.body?.cancel()
    return false
  }
  const current = canonicalFileJson(await response.text())
  if (file.path !== path || current !== expected) return false
  retainFileValidator(file, response)
  return true
}

function isNativeFileValidator(value: string | null | undefined): boolean {
  return /^"native-v\d+-[a-f0-9]{64}(?:-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})?"$/.test(
    value ?? ''
  )
}

function retainFileValidator(file: UserFile, response: Response) {
  const etag = response.headers.get('ETag')
  remoteFileValidators.delete(toRaw(file))
  if (etag && /^"[^"\r\n]*"$/.test(etag))
    remoteFileValidators.set(toRaw(file), etag)
}

function canonicalFileJson(text: string): string | undefined {
  const canonical = (value: unknown, depth = 0): unknown => {
    if (depth > 40) return undefined
    if (Array.isArray(value)) {
      const items = value.map((item) => canonical(item, depth + 1))
      return items.includes(undefined) ? undefined : items
    }
    if (value !== null && typeof value === 'object') {
      const entries = Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => [key, canonical(item, depth + 1)] as const)
      return entries.some(([, item]) => item === undefined)
        ? undefined
        : Object.fromEntries(entries)
    }
    return value
  }
  try {
    return JSON.stringify(canonical(JSON.parse(text)))
  } catch {
    return undefined
  }
}

/**
 * Normalizes a timestamp value that may be either a number (milliseconds)
 * or an ISO 8601 string (from Go's time.Time JSON serialization) into
 * a consistent millisecond timestamp.
 */
function normalizeTimestamp(value: number | string): number {
  if (typeof value === 'string') {
    const ms = new Date(value).getTime()
    return Number.isNaN(ms) ? Date.now() : ms
  }
  return value
}

/**
 * Represents a file in the user's data directory.
 */
export class UserFile {
  /**
   * Various path components.
   * Example:
   * - path: 'dir/file.txt'
   * - directory: 'dir'
   * - fullFilename: 'file.txt'
   * - filename: 'file'
   * - suffix: 'txt'
   */
  directory: string
  fullFilename: string
  filename: string
  suffix: string | null

  isLoading: boolean = false
  content: string | null = null
  originalContent: string | null = null

  constructor(
    /**
     * Path relative to ComfyUI/user/ directory.
     */
    public path: string,
    /**
     * Last modified timestamp.
     */
    public lastModified: number,
    /**
     * File size in bytes. -1 for temporary files.
     */
    public size: number
  ) {
    const details = getPathDetails(path)
    this.directory = details.directory
    this.fullFilename = details.fullFilename
    this.filename = details.filename
    this.suffix = details.suffix
  }

  updatePath(newPath: string) {
    if (this.path !== newPath) remoteFileValidators.delete(toRaw(this))
    const details = getPathDetails(newPath)
    this.path = newPath
    this.directory = details.directory
    this.fullFilename = details.fullFilename
    this.filename = details.filename
    this.suffix = details.suffix
  }

  static createTemporary(path: string): UserFile {
    return new UserFile(path, Date.now(), -1)
  }

  get isTemporary() {
    return this.size === -1
  }

  get isPersisted() {
    return !this.isTemporary
  }

  get key(): string {
    return this.path
  }

  get isLoaded() {
    return this.content !== null
  }

  get isModified() {
    return this.content !== this.originalContent
  }

  /**
   * Loads the file content from the remote storage.
   */
  async load({
    force = false
  }: { force?: boolean } = {}): Promise<LoadedUserFile> {
    if (this.isTemporary || (!force && this.isLoaded))
      return this as LoadedUserFile

    this.isLoading = true
    try {
      const resp = await api.getUserData(this.path)
      if (resp.status !== 200) {
        throw new Error(
          `Failed to load file '${this.path}': ${resp.status} ${resp.statusText}`
        )
      }
      this.content = await resp.text()
      this.originalContent = this.content
      retainFileValidator(this, resp)
      return this as LoadedUserFile
    } finally {
      this.isLoading = false
    }
  }

  /**
   * Unloads the file content from memory
   */
  unload(): void {
    remoteFileValidators.delete(toRaw(this))
    this.content = null
    this.originalContent = null
    this.isLoading = false
  }

  async saveAs(newPath: string): Promise<UserFile> {
    const tempFile = this.isTemporary ? this : UserFile.createTemporary(newPath)
    tempFile.content = this.content
    await tempFile.save()
    return tempFile
  }

  /**
   * Saves the file to the remote storage.
   * @param force Whether to force the save even if the file is not modified.
   */
  async save({ force = false }: { force?: boolean } = {}): Promise<UserFile> {
    if (this.isPersisted && !this.isModified && !force) return this

    const submittedContent = this.content
    const submittedPath = this.path
    if (
      (this.path.startsWith('workflows/.native-agent/') ||
        isNativeFileValidator(remoteFileValidators.get(toRaw(this)))) &&
      submittedContent !== null
    ) {
      const path = this.path
      const latest = await api.getUserData(path)
      const submittedJson = canonicalFileJson(submittedContent)
      if (
        this.path === path &&
        latest.status === 200 &&
        submittedJson !== undefined &&
        canonicalFileJson(await latest.text()) === submittedJson &&
        isNativeFileValidator(latest.headers.get('ETag'))
      )
        retainFileValidator(this, latest)
    }
    if (this.path !== submittedPath) return this
    const etag = remoteFileValidators.get(toRaw(this))
    const resp = await api.storeUserData(submittedPath, submittedContent, {
      overwrite: this.isPersisted,
      throwOnError: true,
      full_info: true,
      ...(etag ? { headers: { 'If-Match': etag } } : {})
    })

    const updatedFile = await readUserDataMutationResponse(
      resp,
      storedUserDataResponseSchema,
      'save'
    )
    if (this.path !== submittedPath) return this
    if (updatedFile !== undefined) {
      this.lastModified = normalizeTimestamp(updatedFile.modified)
      this.size = updatedFile.size
    }
    retainFileValidator(this, resp)
    this.originalContent = submittedContent
    return this
  }

  async delete(): Promise<void> {
    if (this.isTemporary) return

    const etag = remoteFileValidators.get(toRaw(this))
    const resp = etag
      ? await api.deleteUserData(this.path, { headers: { 'If-Match': etag } })
      : await api.deleteUserData(this.path)
    if (resp.status !== 204) {
      throw new Error(
        `Failed to delete file '${this.path}': ${resp.status} ${resp.statusText}`
      )
    }
  }

  async rename(newPath: string): Promise<UserFile> {
    if (this.isTemporary) {
      this.updatePath(newPath)
      return this
    }

    const previousValidator = remoteFileValidators.get(toRaw(this))
    const resp = await api.moveUserData(this.path, newPath)
    if (resp.status !== 200) {
      throw new Error(
        `Failed to rename file '${this.path}': ${resp.status} ${resp.statusText}`
      )
    }
    this.updatePath(newPath)
    if (isNativeFileValidator(resp.headers.get('ETag'))) {
      if (previousValidator)
        remoteFileValidators.set(toRaw(this), previousValidator)
    } else {
      retainFileValidator(this, resp)
    }
    const updatedFile = await readUserDataMutationResponse(
      resp,
      movedUserDataResponseSchema,
      'rename'
    )
    if (updatedFile !== undefined) {
      this.lastModified = normalizeTimestamp(updatedFile.modified)
      this.size = updatedFile.size
    }
    return this
  }
}

interface LoadedUserFile extends UserFile {
  isLoaded: true
  originalContent: string
  content: string
}

export const useUserFileStore = defineStore('userFile', () => {
  const userFilesByPath = ref<Record<string, UserFile>>({})

  const userFiles = computed(() => Object.values(userFilesByPath.value))
  const modifiedFiles = computed(() =>
    userFiles.value.filter((file: UserFile) => file.isModified)
  )
  const loadedFiles = computed(() =>
    userFiles.value.filter((file: UserFile) => file.isLoaded)
  )

  const fileTree = computed<TreeExplorerNode<UserFile>>(() =>
    buildTree<UserFile>(userFiles.value, (userFile: UserFile) =>
      userFile.path.split('/')
    )
  )

  /**
   * Syncs the files in the given directory with the API.
   * @param dir The directory to sync.
   */
  const syncFiles = async (dir: string = '') => {
    await syncEntities(
      dir,
      userFilesByPath.value,
      (file) => new UserFile(file.path, file.modified, file.size),
      (existingFile, file) => {
        existingFile.lastModified = file.modified
        existingFile.size = file.size
        existingFile.unload()
      }
    )
  }

  return {
    userFiles,
    modifiedFiles,
    loadedFiles,
    fileTree,
    syncFiles
  }
})
