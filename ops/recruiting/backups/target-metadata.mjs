/** Uses workspace-scoped metadata APIs without reading database tables or retrying uncertain writes. */
export const createMetadataClient = ({
  target,
  workspaceId,
  token,
  fetchImpl = fetch,
  localRequest,
}) => {
  const url = new URL(target);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  )
    throw new Error('Expected an origin without credentials or a path');
  if (
    url.protocol !== 'https:' &&
    !(
      ['localhost', '127.0.0.1'].includes(url.hostname) &&
      url.protocol === 'http:'
    )
  )
    throw new Error('Remote metadata requires HTTPS');
  if (!workspaceId || (!token && !localRequest))
    throw new Error('Workspace and authentication are required');
  const request = async (path, options = {}) => {
    const response = localRequest
      ? await localRequest(path, options)
      : await fetchImpl(new URL(path, url), {
          ...options,
          redirect: 'error',
          signal: AbortSignal.timeout(60000),
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${token}`,
            ...options.headers,
          },
        });
    if (!response.ok) throw new Error(`Metadata HTTP ${response.status}`);
    return response.json();
  };
  const graphql = async (query, variables = {}) => {
    for (let attempt = 0; ; attempt++) {
      const body = await request('/metadata', {
        method: 'POST',
        body: JSON.stringify({ query, variables }),
      });
      if (!body.errors?.length) return body.data;
      const blocked =
        body.errors.length === 1 &&
        body.errors[0].extensions?.subCode ===
          'DEFERRED_WORKSPACE_MIGRATION_ACTIONS_IN_PROGRESS';
      if (blocked && attempt < 20) {
        await new Promise((done) => setTimeout(done, 500));
        continue;
      }
      throw new Error(
        `Metadata rejected: ${body.errors[0].extensions?.subCode ?? body.errors[0].extensions?.code ?? 'UNKNOWN'}`,
      );
    }
  };
  const inspect = async () => {
    const current = await graphql('{currentWorkspace{id}}');
    if (current.currentWorkspace.id !== workspaceId)
      throw new Error('Workspace identity mismatch; no mutations sent');
    const objects = [];
    const cursors = new Set();
    let cursor;
    do {
      const search = new URLSearchParams({ limit: '100' });
      if (cursor) search.set('starting_after', cursor);
      const body = await request(`/rest/metadata/objects?${search}`);
      const page = Array.isArray(body.data) ? body.data : body.data?.objects;
      if (!Array.isArray(page) || page.some((o) => !Array.isArray(o.fields)))
        throw new Error('Unexpected metadata response');
      objects.push(...page);
      if (!body.pageInfo?.hasNextPage) break;
      cursor = body.pageInfo.endCursor;
      if (!cursor || cursors.has(cursor))
        throw new Error('Invalid metadata pagination');
      cursors.add(cursor);
    } while (true);
    return objects;
  };
  return { inspect, graphql };
};

/** Refuses incompatible fields before any writes; preserves existing fields, options and larger file limits. */
export const planMetadata = (current, objects, fields) => {
  const plan = [];
  for (const object of objects)
    if (!current.some((o) => o.nameSingular === object.nameSingular))
      plan.push({ action: 'createObject', object });
  for (const [objectName, field] of fields) {
    const object = current.find((o) => o.nameSingular === objectName);
    if (!object && !objects.some((o) => o.nameSingular === objectName))
      throw new Error(`Required existing object is absent: ${objectName}`);
    const existing = object?.fields.find((f) => f.name === field.name);
    if (existing?.isActive === false)
      throw new Error(
        `Required field is inactive: ${objectName}.${field.name}`,
      );
    if (existing && existing.type !== field.type)
      throw new Error(`Conflicting field type: ${objectName}.${field.name}`);
    if (!existing) {
      plan.push({ action: 'createField', objectName, field });
      continue;
    }
    if (
      field.type === 'FILES' &&
      (existing.settings?.maxNumberOfValues ?? 0) <
        field.settings.maxNumberOfValues
    )
      plan.push({
        action: 'updateField',
        objectName,
        id: existing.id,
        name: field.name,
        update: { settings: { ...existing.settings, ...field.settings } },
      });
    if (field.options) {
      const missing = field.options.filter(
        (o) => !existing.options?.some((saved) => saved.value === o.value),
      );
      if (missing.length)
        plan.push({
          action: 'updateField',
          objectName,
          id: existing.id,
          name: field.name,
          update: {
            options: [
              ...(existing.options ?? []),
              ...missing.map((o, i) => ({
                ...o,
                position: (existing.options?.length ?? 0) + i,
              })),
            ],
          },
        });
    }
  }
  return plan;
};
