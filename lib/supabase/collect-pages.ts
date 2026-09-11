export type SupabasePageError = { message?: string } | Error | null;

export type SupabasePageResult<T> = {
  data: T[] | null;
  error: SupabasePageError;
};

export type CollectedRowsResult<T> = {
  data: T[];
  error: Error | null;
};

export const DEFAULT_SUPABASE_PAGE_SIZE = 1000;
export const DEFAULT_SUPABASE_MAX_PAGES = 100;

function normalisePageError(error: Exclude<SupabasePageError, null>) {
  if (error instanceof Error) return error;
  return new Error(error.message || 'Supabase paginated query failed.');
}

/**
 * Collects a PostgREST/Supabase rowset in deterministic range pages so callers do
 * not silently stop at the project's API max-row setting (commonly 1,000 rows).
 */
export async function collectSupabasePages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<SupabasePageResult<T>>,
  options: { pageSize?: number; maxPages?: number } = {},
): Promise<T[]> {
  const pageSize = Math.max(1, Math.trunc(options.pageSize ?? DEFAULT_SUPABASE_PAGE_SIZE));
  const maxPages = Math.max(1, Math.trunc(options.maxPages ?? DEFAULT_SUPABASE_MAX_PAGES));
  const rows: T[] = [];

  for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
    const from = pageIndex * pageSize;
    const to = from + pageSize - 1;
    const result = await fetchPage(from, to);
    if (result.error) throw normalisePageError(result.error);

    const page = result.data ?? [];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }

  throw new Error(`Supabase pagination exceeded ${maxPages.toLocaleString('en-ZA')} pages; refusing to return a partial fleet result.`);
}

export async function collectSupabasePagesResult<T>(
  fetchPage: (from: number, to: number) => PromiseLike<SupabasePageResult<T>>,
  options: { pageSize?: number; maxPages?: number } = {},
): Promise<CollectedRowsResult<T>> {
  try {
    return { data: await collectSupabasePages(fetchPage, options), error: null };
  } catch (error) {
    return {
      data: [],
      error: error instanceof Error ? error : new Error('Supabase paginated query failed.'),
    };
  }
}
