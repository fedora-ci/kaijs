/**
 * Backfill NVRs of Brew draft builds that were promoted before
 * VirtualTopic.eng.brew.build.promote was handled by the loader.
 *
 * Finds parent docs with `nvr: *,draft_*`, asks Brew for the current build info and,
 * when the build is not a draft anymore, stores the new `nvr` and keeps the old one in `nvrDraft`.
 *
 * BREW_HUB_URL=https://brewhub.example.com/brewhub \
 *   node build/scripts/backfill_promoted_drafts.js [--dry-run]
 */
import _ from 'lodash';
import xmlrpc from 'xmlrpc';
import { Client } from '@opensearch-project/opensearch';
import { getcfg } from '../cfg';
import { getIndexName } from '../opensearch/opensearch';

const cfg = getcfg();
const dryRun = process.argv.includes('--dry-run');
const brewHubUrl = process.env.BREW_HUB_URL;

if (!brewHubUrl) {
  console.error('BREW_HUB_URL is not set');
  process.exit(1);
}
const brew = xmlrpc.createSecureClient(brewHubUrl);

const getBuild = (buildId: number): Promise<any> =>
  new Promise((resolve, reject) => {
    brew.methodCall('getBuild', [buildId], (err: any, value: any) =>
      err ? reject(err) : resolve(value),
    );
  });

const main = async () => {
  const client = new Client(cfg.loader.opensearch.client);
  const index = getIndexName('redhat', 'brew-build');
  const summary = { found: 0, promoted: 0, stillDraft: 0, failed: 0 };
  /** Several parent docs can point to the same build. */
  const builds = new Map<number, Promise<any>>();
  const concurrency = 10;
  try {
    let response = await client.search({
      index,
      scroll: '10m',
      size: 100,
      body: {
        query: {
          bool: {
            filter: [
              { term: { 'artToMsgs': 'artifact' } },
              { term: { aType: 'brew-build' } },
              /**
               * `nvr` is an analyzed text field; match loosely here and check the exact
               * `,draft_` suffix below.
               */
              {
                query_string: {
                  default_field: 'nvr',
                  query: '*draft_*',
                  analyze_wildcard: true,
                  allow_leading_wildcard: true,
                },
              },
            ],
          },
        },
      },
    });
    const processHit = async (hit: any) => {
      const { nvr, buildId } = hit._source;
      /** Draft release is `<release>,draft_<build id>`. */
      const draftMatch = /,draft_(\d+)$/.exec(nvr || '');
      if (!draftMatch) {
        return;
      }
      summary.found++;
      /** Parents created by CI test messages have no buildId. */
      const id = Number(buildId || draftMatch[1]);
      try {
        if (!builds.has(id)) {
          builds.set(id, getBuild(id));
        }
        const build = await builds.get(id);
        if (!build || build.draft) {
          summary.stillDraft++;
          return;
        }
        console.log(
          `${dryRun ? '[dry-run] ' : ''}${hit._id}: ${nvr} -> ${build.nvr}`,
        );
        summary.promoted++;
        if (!dryRun) {
          await client.update({
            index: hit._index,
            id: hit._id,
            routing: hit._routing,
            body: { doc: { nvr: build.nvr, nvrDraft: nvr } },
          });
        }
      } catch (err) {
        summary.failed++;
        console.error(`${hit._id}: ${_.get(err, 'message', err)}`);
      }
    };
    while (response.body.hits.hits.length > 0) {
      for (const chunk of _.chunk(response.body.hits.hits, concurrency)) {
        await Promise.all(_.map(chunk, processHit));
      }
      response = await client.scroll({
        scroll_id: response.body._scroll_id,
        scroll: '10m',
      });
    }
    await client.clearScroll({ scroll_id: response.body._scroll_id });
  } finally {
    await client.close();
  }
  console.log('Summary:', summary);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
