/*
 * This file is part of kaijs

 * Copyright (c) 2021 Andrei Stepanov <astepano@redhat.com>
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

import fs from 'fs';
import _ from 'lodash';
import path from 'path';
import debug from 'debug';
import yaml from 'js-yaml';
import assert from 'assert';
import { ConnectionOptions } from 'rhea-promise';
import { ClientOptions } from '@opensearch-project/opensearch/.';

const log = debug('kaijs:cfg');
/** Default config must present */
const DEF_CFG_FILENAME = 'config-default.yaml';
const DEF_CFG_PATH = path.join(__dirname, '../assets', DEF_CFG_FILENAME);
assert.strictEqual(
  fs.existsSync(DEF_CFG_PATH),
  true,
  'Default configuration is absent. Cannot continue.',
);
/** Additional config with overriden params */
const OVERRIDE_CFG_FILENAME = 'config-kaijs.yaml';
const OVERRIDE_CFG_LOOKUP_DIRS = [
  process.cwd(),
  path.join(__dirname, '../assets'),
];
const OVERRIDE_CFG_LOOKUP_PATHS = _.map(OVERRIDE_CFG_LOOKUP_DIRS, (d) =>
  path.join(d, OVERRIDE_CFG_FILENAME),
);
if (process.env.KAIJS_CFG_PATH) {
  OVERRIDE_CFG_LOOKUP_PATHS.unshift(process.env.KAIJS_CFG_PATH);
}
log('Config lookup priority paths:');
for (const cfgpath of OVERRIDE_CFG_LOOKUP_PATHS) {
  log(cfgpath);
}

const mk_config_from_env: any = _.flow(
  _.identity,
  _.toPairs,
  _.partialRight(
    _.map,
    _.cond([
      [
        _.flow([_.last, _.isArray]),
        _.flow([
          _.over([
            _.head,
            _.flow(
              _.last,
              _.head,
              _.partial(_.get, process.env, _, undefined),
              _.cond([
                [_.isUndefined, _.stubArray],
                [
                  _.stubTrue,
                  _.flow(_.ary(_.trim, 1), _.partial(_.split, _, '\n')),
                ],
              ]),
            ),
          ]),
          _.cond([
            [_.flow([_.last, _.size]), _.identity],
            [_.stubTrue, _.noop],
          ]),
        ]),
      ],
      [
        _.flow([_.last, _.isPlainObject]),
        _.flow([
          _.over([_.head, _.flow(_.last, (o) => mk_config_from_env(o))]),
          _.cond([
            [_.flow([_.last, _.size]), _.identity],
            [_.stubTrue, _.noop],
          ]),
        ]),
      ],
      [
        _.stubTrue,
        _.flow([
          _.over([
            _.head,
            _.flow(_.last, _.partial(_.get, process.env, _, undefined)),
          ]),
          _.cond([
            [_.flow([_.last, _.isString]), _.identity],
            [_.stubTrue, _.noop],
          ]),
        ]),
      ],
    ]),
  ),
  _.compact,
  _.fromPairs,
);

type YamlItem = string | number | object | null | undefined;

class Config {
  private config_default: YamlItem;
  private config_override: YamlItem = {};
  private config_from_env: YamlItem = {};
  public config_active: YamlItem = {};
  constructor() {
    try {
      const def_cfg_contents = fs.readFileSync(DEF_CFG_PATH, 'utf8');
      this.config_default = yaml.load(def_cfg_contents) as YamlItem;
    } catch (err) {
      console.warn('Cannot proceed default configuration: ', DEF_CFG_PATH);
      throw err;
    }
    //log('Default config: %s', '\n' + yaml.dump(this.config_default));
    var override_cfg_path: string;
    for (override_cfg_path of OVERRIDE_CFG_LOOKUP_PATHS) {
      log(override_cfg_path);
      if (fs.existsSync(override_cfg_path)) {
        log('Read overide configuration from file: %s', override_cfg_path);
        try {
          const override_cfg_contents = fs.readFileSync(
            override_cfg_path,
            'utf8',
          );
          this.config_override = yaml.load(override_cfg_contents) as YamlItem;
          log('Override config: %s', '\n' + yaml.dump(this.config_override));
          break;
        } catch (err) {
          /** ignore */
        }
      }
    }
    if (this.config_default != null && typeof this.config_default == 'object') {
      const env_to_config_map = _.get(this.config_default, 'env_to_config_map');
      this.config_from_env = mk_config_from_env(env_to_config_map);
      /**
       * Uncomment to print Environment config
       */
      //log('Environment config: %s', '\n' + yaml.dump(this.config_from_env));
    }
    /** Priority order */
    _.defaultsDeep(
      this.config_active,
      this.config_from_env,
      this.config_override,
      this.config_default,
    );
    _.unset(this.config_active, 'env_to_config_map');
    /**
     * Uncomment to print whole active config
     */
    log('Active config: %s', '\n' + yaml.dump(this.config_active));
    /** constructor in javascript returns this object automatically
     * constructor returns the type of the class, the constructor implicitly returns 'this'
     * Even though you technically can't extend a proxy, there is a way to force a class
     * to instantiate as a proxy.
     * https://stackoverflow.com/questions/37714787/can-i-extend-proxy-with-an-es2015-class/40714458#40714458
     */
    const handler = {
      get: (target: Config, prop: string): YamlItem => {
        return _.get(target.config_active, prop);
      },
    };
    return new Proxy(this, handler);
  }
}

export const getcfg = _.once((): Cfg => {
  return new Config() as unknown as Cfg;
});

export interface Cfg {
  listener: {
    broker_umb: {
      client_name: string;
      subscription_id: string;
      connection: ConnectionOptions;
      prefetch: number;
      failover: {
        set: string[];
      };
      topics: {
        set: string[];
      };
    };
    broker_rabbitmq: {
      url: string;
      keypath: string;
      certpath: string;
      cacertpath: string;
      exchange_name: string;
      prefetch: string;
      topics: {
        set: string[];
      };
    };
    file_queue_path: string;
  };
  loader: {
    db: {
      db_url: string;
      db_name: string;
      collections: {
        artifacts: {
          name: string;
          indexes: [{ keys: any; options: any }];
        };
        invalid: {
          name: string;
          indexes: [{ keys: any; options: any }];
        };
        raw_messages: {
          name: string;
          indexes: [{ keys: any; options: any }];
        };
      };
    };
    opensearch: {
      client: ClientOptions;
      indexes_prefix: string;
    };
    schemas_git_upstream: string;
    schemas_local_git_repo_path: string;
    schemas_local_dir_unpacked: string;
    file_queue_path: string;
  };
  koji_fp: {
    host: string;
    port: number;
    path: string;
    headers: {
      useragent: string;
    };
  };
  koji_cs: {
    host: string;
    port: number;
    path: string;
    headers: {
      useragent: string;
    };
  };
}

export function mkDirParents(
  targetDir: string,
  { isRelativeToScript = false } = {},
): string {
  const baseDir = isRelativeToScript ? __dirname : process.cwd();
  const dir = path.resolve(baseDir, targetDir);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
  }
  assert.strictEqual(
    fs.statSync(dir).isDirectory(),
    true,
    `Is not directory: ${dir}.`,
  );
  return dir;
}
