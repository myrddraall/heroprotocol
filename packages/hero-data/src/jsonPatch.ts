/** One RFC 6902 operation, as heroes-data2 publishes them between versions. */
export interface JsonPatchOperation {
  readonly op: 'add' | 'remove' | 'replace' | 'move' | 'copy' | 'test';
  readonly path: string;
  readonly from?: string;
  readonly value?: unknown;
}

type Container = Record<string, unknown> | unknown[];

const tokens = (pointer: string): string[] =>
  pointer === ''
    ? []
    : pointer
        .slice(1)
        .split('/')
        .map((t) => t.replace(/~1/g, '/').replace(/~0/g, '~'));

function parentOf(doc: unknown, pointer: string): [Container, string] {
  const path = tokens(pointer);
  if (path.length === 0) throw new Error('json-patch: cannot address the document root');
  let node = doc;
  for (const t of path.slice(0, -1)) {
    node = (node as Record<string, unknown> | undefined)?.[t];
    if (node === null || typeof node !== 'object')
      throw new Error(`json-patch: no container at ${pointer}`);
  }
  return [node as Container, path.at(-1)!];
}

function get(doc: unknown, pointer: string): unknown {
  let node = doc;
  for (const t of tokens(pointer)) node = (node as Record<string, unknown> | undefined)?.[t];
  return node;
}

function remove(doc: unknown, pointer: string): unknown {
  const [parent, key] = parentOf(doc, pointer);
  if (Array.isArray(parent)) return parent.splice(Number(key), 1)[0];
  if (!(key in parent)) throw new Error(`json-patch: nothing to remove at ${pointer}`);
  const old = parent[key];
  delete parent[key];
  return old;
}

function add(doc: unknown, pointer: string, value: unknown): void {
  const [parent, key] = parentOf(doc, pointer);
  if (Array.isArray(parent)) parent.splice(key === '-' ? parent.length : Number(key), 0, value);
  else parent[key] = value;
}

/**
 * Apply a JSON patch to `doc` in place and return it. Values are inserted by
 * reference, so pass a document (and patch) the caller owns.
 */
export function applyJsonPatch<T>(doc: T, patch: readonly JsonPatchOperation[]): T {
  for (const op of patch) {
    switch (op.op) {
      case 'add':
        add(doc, op.path, op.value);
        break;
      case 'remove':
        remove(doc, op.path);
        break;
      case 'replace': {
        const [parent, key] = parentOf(doc, op.path);
        if (Array.isArray(parent)) parent[Number(key)] = op.value;
        else parent[key] = op.value;
        break;
      }
      case 'move':
        add(doc, op.path, remove(doc, op.from!));
        break;
      case 'copy':
        add(doc, op.path, structuredClone(get(doc, op.from!)));
        break;
      case 'test':
        if (JSON.stringify(get(doc, op.path)) !== JSON.stringify(op.value))
          throw new Error(`json-patch: test failed at ${op.path}`);
        break;
    }
  }
  return doc;
}
