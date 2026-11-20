import { beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'

import { reportError } from '@/platform/telemetry/reportError'
import { api } from '@/scripts/api'
import { UserFile, useUserFileStore } from '@/stores/userFileStore'

// Mock the api
vi.mock<unknown>(import('@/scripts/api'), () => ({
  api: {
    listUserDataFullInfo: vi.fn(),
    getUserData: vi.fn(),
    storeUserData: vi.fn(),
    deleteUserData: vi.fn(),
    moveUserData: vi.fn()
  }
}))

vi.mock(import('@/platform/telemetry/reportError'))

describe('useUserFileStore', () => {
  let store: ReturnType<typeof useUserFileStore>

  beforeEach(() => {
    store = useUserFileStore()
  })

  it('should initialize with empty files', () => {
    expect(store.userFiles).toHaveLength(0)
    expect(store.modifiedFiles).toHaveLength(0)
    expect(store.loadedFiles).toHaveLength(0)
  })

  describe('syncFiles', () => {
    it('should add new files', async () => {
      const mockFiles = [
        { path: 'file1.txt', modified: 123, size: 100 },
        { path: 'file2.txt', modified: 456, size: 200 }
      ]
      vi.mocked(api.listUserDataFullInfo).mockResolvedValue(mockFiles)

      await store.syncFiles('dir')

      expect(store.userFiles).toHaveLength(2)
      expect(store.userFiles[0].path).toBe('dir/file1.txt')
      expect(store.userFiles[1].path).toBe('dir/file2.txt')
    })

    it('should update existing files', async () => {
      const initialFile = { path: 'file1.txt', modified: 123, size: 100 }
      vi.mocked(api.listUserDataFullInfo).mockResolvedValue([initialFile])
      await store.syncFiles('dir')

      const updatedFile = { path: 'file1.txt', modified: 456, size: 200 }
      vi.mocked(api.listUserDataFullInfo).mockResolvedValue([updatedFile])
      await store.syncFiles('dir')

      expect(store.userFiles).toHaveLength(1)
      expect(store.userFiles[0].lastModified).toBe(456)
      expect(store.userFiles[0].size).toBe(200)
    })

    it('should remove non-existent files', async () => {
      const initialFiles = [
        { path: 'file1.txt', modified: 123, size: 100 },
        { path: 'file2.txt', modified: 456, size: 200 }
      ]
      vi.mocked(api.listUserDataFullInfo).mockResolvedValue(initialFiles)
      await store.syncFiles('dir')

      const updatedFiles = [{ path: 'file1.txt', modified: 123, size: 100 }]
      vi.mocked(api.listUserDataFullInfo).mockResolvedValue(updatedFiles)
      await store.syncFiles('dir')

      expect(store.userFiles).toHaveLength(1)
      expect(store.userFiles[0].path).toBe('dir/file1.txt')
    })

    it('should sync root directory when no directory is specified', async () => {
      const mockFiles = [{ path: 'file1.txt', modified: 123, size: 100 }]
      vi.mocked(api.listUserDataFullInfo).mockResolvedValue(mockFiles)

      await store.syncFiles()

      expect(api.listUserDataFullInfo).toHaveBeenCalledWith('')
      expect(store.userFiles).toHaveLength(1)
      expect(store.userFiles[0].path).toBe('file1.txt')
    })
  })

  describe('UserFile', () => {
    describe('load', () => {
      it('should load file content', async () => {
        const file = new UserFile('file1.txt', 123, 100)
        vi.mocked(api.getUserData).mockResolvedValue(
          new Response('file content')
        )

        await file.load()

        expect(file.content).toBe('file content')
        expect(file.originalContent).toBe('file content')
        expect(file.isLoading).toBe(false)
        expect(file.isLoaded).toBe(true)
      })

      it('should throw error on failed load', async () => {
        const file = new UserFile('file1.txt', 123, 100)
        vi.mocked(api.getUserData).mockResolvedValue({
          status: 404,
          statusText: 'Not Found'
        } as Response)

        await expect(file.load()).rejects.toThrow(
          "Failed to load file 'file1.txt': 404 Not Found"
        )
      })
    })

    describe('save', () => {
      it('does not publish captured native content into a path changed during checkpoint preparation', async () => {
        const file = new UserFile(
          'workflows/.native-agent/example.json',
          123,
          100
        )
        file.originalContent = '{"nodes":[],"links":[]}'
        file.content = '{"nodes":[],"links":[],"extra":{"mine":true}}'
        const response = Promise.withResolvers<Response>()
        vi.mocked(api.getUserData).mockReturnValueOnce(response.promise)
        const saving = file.save()
        file.updatePath('workflows/other.json')
        response.resolve(
          new Response(file.content, {
            headers: { ETag: `"native-v2-${'b'.repeat(64)}"` }
          })
        )
        await saving
        expect(api.storeUserData).not.toHaveBeenCalled()
        expect(file.isModified).toBe(true)
        expect(file.originalContent).toBe('{"nodes":[],"links":[]}')
      })

      it('refreshes a native checkpoint validator only when the submitted graph is already persisted', async () => {
        const file = new UserFile(
          'workflows/.native-agent/example.json',
          123,
          100
        )
        const old = `"native-v1-${'a'.repeat(64)}"`
        const current = `"native-v2-${'b'.repeat(64)}"`
        vi.mocked(api.getUserData).mockResolvedValueOnce(
          new Response('{"nodes":[],"links":[]}', { headers: { ETag: old } })
        )
        await file.load()
        file.content = '{"nodes":[],"links":[],"extra":{"saved":true}}'
        vi.mocked(api.getUserData).mockResolvedValueOnce(
          new Response('{"extra":{"saved":true},"links":[],"nodes":[]}', {
            headers: { ETag: current }
          })
        )
        vi.mocked(api.storeUserData).mockResolvedValueOnce(
          Response.json(
            { modified: 456, size: 60 },
            { headers: { ETag: current } }
          )
        )
        await file.save()
        expect(api.storeUserData).toHaveBeenCalledWith(
          file.path,
          file.content,
          expect.objectContaining({ headers: { 'If-Match': current } })
        )
        expect(file.isModified).toBe(false)
      })

      it('does not rebase an unsaved graph onto a different remote edit', async () => {
        const file = new UserFile(
          'workflows/.native-agent/example.json',
          123,
          100
        )
        const old = `"native-v1-${'a'.repeat(64)}"`
        vi.mocked(api.getUserData).mockResolvedValueOnce(
          new Response('{"nodes":[],"links":[]}', { headers: { ETag: old } })
        )
        await file.load()
        file.content = '{"nodes":[],"links":[],"extra":{"mine":true}}'
        vi.mocked(api.getUserData).mockResolvedValueOnce(
          new Response('{"nodes":[],"links":[],"extra":{"other":true}}', {
            headers: { ETag: `"native-v2-${'b'.repeat(64)}"` }
          })
        )
        vi.mocked(api.storeUserData).mockRejectedValueOnce(
          new Error('412 conflict')
        )
        await expect(file.save()).rejects.toThrow('412 conflict')
        expect(api.storeUserData).toHaveBeenCalledWith(
          file.path,
          file.content,
          expect.objectContaining({ headers: { 'If-Match': old } })
        )
        expect(file.isModified).toBe(true)
        expect(file.originalContent).toBe('{"nodes":[],"links":[]}')
      })

      it('advances the loaded validator after a successful save', async () => {
        const rawFile = new UserFile('workflow.json', 123, 100)
        const file = reactive(rawFile)
        vi.mocked(api.getUserData).mockResolvedValue(
          new Response('base', { headers: { ETag: '"v1"' } })
        )
        await rawFile.load()
        file.content = 'next'
        vi.mocked(api.storeUserData).mockImplementation(async () =>
          Response.json(
            { modified: 456, size: 4 },
            { headers: { ETag: '"v2"' } }
          )
        )
        await file.save()
        file.content = 'later'
        await file.save()
        expect(
          vi
            .mocked(api.storeUserData)
            .mock.calls.map((call) => call[2]?.headers)
        ).toEqual([{ 'If-Match': '"v1"' }, { 'If-Match': '"v2"' }])
      })

      it('keeps edits made during an in-flight save unsaved', async () => {
        const file = new UserFile('workflow.json', 123, 100)
        file.originalContent = 'base'
        file.content = 'submitted'
        const response = Promise.withResolvers<Response>()
        vi.mocked(api.storeUserData).mockReturnValue(response.promise)
        const saving = file.save()
        file.content = 'newer edit'
        response.resolve(Response.json({ modified: 456, size: 9 }))
        await saving
        expect(file.originalContent).toBe('submitted')
        expect(file.content).toBe('newer edit')
        expect(file.isModified).toBe(true)
      })

      it('preserves dirty content after a rejected save', async () => {
        const file = new UserFile('workflow.json', 123, 100)
        vi.mocked(api.getUserData).mockResolvedValue(
          new Response('base', { headers: { ETag: '"v1"' } })
        )
        await file.load()
        file.content = 'unsaved'
        vi.mocked(api.storeUserData).mockRejectedValue(
          new Error('412 conflict')
        )
        await expect(file.save()).rejects.toThrow('412 conflict')
        expect(file.originalContent).toBe('base')
        expect(file.content).toBe('unsaved')
        expect(file.isModified).toBe(true)
        expect(file.lastModified).toBe(123)
      })

      it.for(['unload', 'path change', 'save as'] as const)(
        'does not transfer a validator after %s',
        async (action) => {
          const file = new UserFile('workflow.json', 123, 100)
          vi.mocked(api.getUserData).mockResolvedValue(
            new Response('base', { headers: { ETag: '"v1"' } })
          )
          await file.load()
          vi.mocked(api.storeUserData).mockResolvedValue(
            Response.json({ modified: 456, size: 4 })
          )
          const actions = {
            unload: async () => {
              file.unload()
              file.content = 'next'
              await file.save()
            },
            'path change': async () => {
              file.updatePath('new.json')
              file.content = 'next'
              await file.save()
            },
            'save as': async () => {
              await file.saveAs('new.json')
            }
          }
          await actions[action]()
          expect(
            vi.mocked(api.storeUserData).mock.calls[0]?.[2]?.headers
          ).toBeUndefined()
        }
      )

      it('should save modified file', async () => {
        const file = new UserFile('file1.txt', 123, 100)
        file.content = 'modified content'
        file.originalContent = 'original content'
        vi.mocked(api.storeUserData).mockResolvedValue(
          Response.json({ modified: 456, size: 200 })
        )

        await file.save()

        expect(api.storeUserData).toHaveBeenCalledWith(
          'file1.txt',
          'modified content',
          { throwOnError: true, full_info: true, overwrite: true }
        )
        expect(file.lastModified).toBe(456)
        expect(file.size).toBe(200)
      })

      it('keeps saved content but ignores malformed response metadata', async () => {
        const file = new UserFile('file1.txt', 123, 100)
        file.content = 'modified content'
        file.originalContent = 'original content'
        vi.mocked(api.storeUserData).mockResolvedValue(
          Response.json({ modified: 'invalid', size: 200 })
        )

        await file.save()

        expect(file.originalContent).toBe('modified content')
        expect(file.lastModified).toBe(123)
        expect(file.size).toBe(100)
        expect(reportError).toHaveBeenCalledWith(expect.anything(), {
          errorType: 'userdata_mutation_invalid_response',
          surface: 'platform',
          tags: { operation: 'save', status: 200 }
        })
      })

      it('should not save unmodified file', async () => {
        const file = new UserFile('file1.txt', 123, 100)
        file.content = 'content'
        file.originalContent = 'content'

        await file.save()

        expect(api.storeUserData).not.toHaveBeenCalled()
      })
    })

    describe('delete', () => {
      it.for([
        `"native-v1-${'a'.repeat(64)}"`,
        `"native-v1-${'a'.repeat(64)}-11111111-1111-4111-8111-111111111111"`
      ])(
        'keeps the loaded native identity conditional when deleting %s',
        async (etag) => {
          const file = new UserFile('workflows/Portrait.json', 123, 100)
          vi.mocked(api.getUserData).mockResolvedValueOnce(
            new Response('{"nodes":[],"links":[]}', { headers: { ETag: etag } })
          )
          await file.load()
          vi.mocked(api.deleteUserData).mockResolvedValueOnce(
            new Response(null, { status: 412 })
          )
          await expect(file.delete()).rejects.toThrow('412')
          expect(api.deleteUserData).toHaveBeenCalledWith(
            'workflows/Portrait.json',
            { headers: { 'If-Match': etag } }
          )
          expect(file.originalContent).toBe('{"nodes":[],"links":[]}')
        }
      )

      it('should delete file', async () => {
        const file = new UserFile('file1.txt', 123, 100)
        vi.mocked(api.deleteUserData).mockResolvedValue({
          status: 204
        } as Response)

        await file.delete()

        expect(api.deleteUserData).toHaveBeenCalledWith('file1.txt')
      })
    })

    describe('rename', () => {
      it('does not adopt a newer document version that arrived during rename', async () => {
        const file = new UserFile(
          'workflows/.native-agent/Original.json',
          123,
          100
        )
        const initial = JSON.stringify({ nodes: [], links: [] })
        const changed = JSON.stringify({
          nodes: [],
          links: [],
          extra: { local: true }
        })
        const first = `"native-v1-${'a'.repeat(64)}-11111111-1111-4111-8111-111111111111"`
        const second = `"native-v2-${'b'.repeat(64)}-11111111-1111-4111-8111-111111111111"`
        vi.mocked(api.getUserData).mockResolvedValueOnce(
          new Response(initial, { headers: { ETag: first } })
        )
        await file.load()
        vi.mocked(api.moveUserData).mockResolvedValue(
          Response.json('workflows/Portrait.json', {
            headers: { ETag: second }
          })
        )
        await file.rename('workflows/Portrait.json')
        file.content = changed
        vi.mocked(api.getUserData).mockResolvedValueOnce(
          new Response(
            JSON.stringify({ nodes: [], links: [], extra: { remote: true } }),
            {
              headers: { ETag: second }
            }
          )
        )
        vi.mocked(api.storeUserData).mockRejectedValueOnce(
          new Error('Workflow base version changed')
        )
        await expect(file.save()).rejects.toThrow(
          'Workflow base version changed'
        )
        expect(api.storeUserData).toHaveBeenCalledWith(
          'workflows/Portrait.json',
          changed,
          expect.objectContaining({ headers: { 'If-Match': first } })
        )
        expect(file.originalContent).toBe(initial)
      })

      it('keeps conditional native saves after renaming outside the native directory', async () => {
        const file = new UserFile(
          'workflows/.native-agent/Original.json',
          123,
          100
        )
        const initial = JSON.stringify({ nodes: [], links: [] })
        const changed = JSON.stringify({
          nodes: [],
          links: [],
          extra: { changed: true }
        })
        const first = `"native-v1-${'a'.repeat(64)}"`
        vi.mocked(api.getUserData).mockImplementation(
          async () => new Response(initial, { headers: { ETag: first } })
        )
        await file.load()
        vi.mocked(api.moveUserData).mockResolvedValue(
          Response.json('workflows/Portrait.json', { headers: { ETag: first } })
        )
        await file.rename('workflows/Portrait.json')
        file.content = changed
        vi.mocked(api.storeUserData).mockResolvedValue(
          Response.json(
            { path: 'workflows/Portrait.json', modified: 456, size: 200 },
            {
              headers: { ETag: `"native-v2-${'b'.repeat(64)}"` }
            }
          )
        )
        await file.save()
        expect(api.storeUserData).toHaveBeenCalledWith(
          'workflows/Portrait.json',
          changed,
          expect.objectContaining({ headers: { 'If-Match': first } })
        )
        expect(file.path).toBe('workflows/Portrait.json')
        expect(file.originalContent).toBe(changed)
      })

      it('should rename file', async () => {
        const file = new UserFile('file1.txt', 123, 100)
        vi.mocked(api.moveUserData).mockResolvedValue(
          Response.json({ modified: 456, size: 200 })
        )

        await file.rename('newfile.txt')

        expect(api.moveUserData).toHaveBeenCalledWith(
          'file1.txt',
          'newfile.txt'
        )
        expect(file.path).toBe('newfile.txt')
        expect(file.lastModified).toBe(456)
        expect(file.size).toBe(200)
      })

      it('keeps the renamed path but ignores malformed response metadata', async () => {
        const file = new UserFile('file1.txt', 123, 100)
        vi.mocked(api.moveUserData).mockResolvedValue(
          Response.json({ modified: 456 })
        )

        await file.rename('newfile.txt')

        expect(file.path).toBe('newfile.txt')
        expect(file.lastModified).toBe(123)
        expect(file.size).toBe(100)
        expect(reportError).toHaveBeenCalledWith(expect.anything(), {
          errorType: 'userdata_mutation_invalid_response',
          surface: 'platform',
          tags: { operation: 'rename', status: 200 }
        })
      })
    })

    describe('saveAs', () => {
      it('should save file with new path', async () => {
        const file = new UserFile('file1.txt', 123, 100)
        file.content = 'file content'
        vi.mocked(api.storeUserData).mockResolvedValue(
          Response.json({ modified: 456, size: 200 })
        )

        const newFile = await file.saveAs('newfile.txt')

        expect(api.storeUserData).toHaveBeenCalledWith(
          'newfile.txt',
          'file content',
          // SaveAs should create a new temporary file, which will mean
          // overwrite is false
          { throwOnError: true, full_info: true, overwrite: false }
        )
        expect(newFile).toBeInstanceOf(UserFile)
        expect(newFile.path).toBe('newfile.txt')
        expect(newFile.lastModified).toBe(456)
        expect(newFile.size).toBe(200)
        expect(newFile.content).toBe('file content')
      })
    })
  })
})
