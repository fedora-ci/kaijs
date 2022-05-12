/*
 * This file is part of ciboard-server

 * Copyright (c) 2022 Andrei Stepanov <astepano@redhat.com>
 * 
 * This program is free software; you can redistribute it and/or
 * modify it under the terms of the GNU Lesser General Public
 * License as published by the Free Software Foundation; either
 * version 3 of the License, or (at your option) any later version.
 * 
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 * Lesser General Public License for more details.
 * 
 * You should have received a copy of the GNU Lesser General Public License
 * along with this program; if not, write to the Free Software Foundation,
 * Inc., 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301, USA.
 */

/**
 * Binding to git: https://www.npmjs.com/package/simple-git
 *
 * ResultsDB logic:
 *
 * https://gitlab.cee.redhat.com/Workflow_Integration/hydra-sp/umb-notifier/-/blob/master/src/main/resources/spring-beans/camel/routes/umbResultsDbRoutes.xml
 * https://gitlab.cee.redhat.com/Workflow_Integration/hydra-sp/umb-notifier/-/blob/master/src/main/java/com/redhat/integration/umbnotifier/services/JsonSchemaValidator.java
 */

import _ from 'lodash';
import debug from 'debug';
import { getcfg, mkDirParents } from './cfg';
import simpleGit, { SimpleGit, SimpleGitOptions } from 'simple-git';

const log = debug('kaijs:get_schema');
const cfg = getcfg();

/**
 * git --git-dir=schemas.git show 'refs/tags/1.1.4:schemas/brew-build-group.test.complete.yaml'
 */
export const getFileFromGitRepo = async (
  tag: string,
  schemaPathInGitRepo: string
): Promise<string> => {
  const { gitRepoPath } = runtimeParams;
  const repoPath = mkDirParents(gitRepoPath);
  const git: SimpleGit = simpleGit(options).env('GIT_DIR', repoPath);
  const gitObject = `refs/tags/${tag}:${schemaPathInGitRepo}`;
  log(' [i] retrieve: %s', gitObject);
  const fileString = await git.show(gitObject);
  return fileString;
};

const options: Partial<SimpleGitOptions> = {
  binary: 'git',
  maxConcurrentProcesses: 6,
};

/**
 * Cloned repo is bare
 * The directory must be absent or must be emtpy
 */
export interface SchemasParams {
  gitRepoPath: string;
  upstreamGit: string;
}

const defaultParams: SchemasParams = {
  gitRepoPath: 'schemas.git',
  upstreamGit: 'https://pagure.io/fedora-ci/messages.git',
};

const suppliedParams: SchemasParams = {
  gitRepoPath: cfg.loader.schemas_local_git_repo_path,
  upstreamGit: cfg.loader.schemas_git_upstream,
};

const runtimeParams: SchemasParams = {
  ...defaultParams,
  ...suppliedParams,
};

export const getAllSchemas = async () => {
  const { gitRepoPath, upstreamGit } = runtimeParams;
  log(' [i] [param] Upstream repo: %s', upstreamGit);
  log(' [i] [param] Cloned repo path: %s', gitRepoPath);
  const repoPath = mkDirParents(gitRepoPath);
  const git: SimpleGit = simpleGit(options).env('GIT_DIR', repoPath);
  /**
   * Check if repo is initialized
   * git --git-dir schemas rev-parse --is-bare-repository
   */
  let isBareGit;
  try {
    isBareGit = await git.revparse({ '--is-bare-repository': null });
  } catch (err) {
    if (!_.isError(err)) {
      throw err;
    }
    if (!/not a git repository/gi.test(err.message)) {
      throw err;
    }
  }
  if (isBareGit !== 'true') {
    log(' [i] clone repo to: %s', repoPath);
    try {
      await git.mirror(upstreamGit, repoPath);
    } catch (e) {
      if (_.isError(e)) {
        console.warn('Cannot clone', upstreamGit, _.toString(e));
        process.exit(1);
      } else {
        throw e;
      }
    }
  }
  log(' [i] git-dir : %s is initialized and is bare.', repoPath);
  /**
   * Next command can be run only if git-dir is present
   */
  const gitConfig = await git.listConfig();
  log(' [i] git config: ', gitConfig);
  log(' [i] get the latest upstream');
  await git.fetch({ '--prune': null, '--prune-tags': null });
  const tags = await git.tags();
  log(' [i] known tags', tags);
};

/**
 * Standalone run, uncomment next line and invoke:
 * DEBUG="osci:*" ts-node get_schema.ts
 * getAllSchemas();
 */
