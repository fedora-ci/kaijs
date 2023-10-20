/*
 * This file is part of kaijs

 * Copyright (c) 2023 Andrei Stepanov <astepano@redhat.com>
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

import _ from 'lodash';
import Joi from 'joi';
import debug from 'debug';
import assert from 'assert';
import { Client, ClientOptions } from '@opensearch-project/opensearch';

import { getcfg } from '../cfg';
import { FileQueueMessage } from '../fqueue';
import { AJVValidationError } from '../validation_ajv';
import { WrongVersionError } from '../validation_broker';
import { assertMsgIsValid, NoValidationSchemaError } from '../validation';
import {
  getHandler,
  NoNeedToProcessError,
  NoAssociatedHandlerError,
} from './msg_handlers';

const log = debug('kaijs:opensearch');
const cfg = getcfg();

export type ArtifactContext = 'redhat' | 'centos' | 'fedora' | 'any';

/**
 * Expect that indexes are present and configured, for example with templates.
 */
export const getIndexName = (
  artifactConext: ArtifactContext,
  artifactType: ArtifactTypes | 'invalid-messages',
) => {
  let indexName = '';
  if (artifactConext === 'redhat') {
    if (artifactType === 'brew-build') {
      indexName = 'redhat-rpm';
    } else if (artifactType === 'koji-build') {
      indexName = 'fedora-rpm';
    } else if (artifactType === 'productmd-compose') {
      indexName = 'redhat-compose';
    } else if (artifactType === 'redhat-module') {
      indexName = 'redhat-module';
    } else if (artifactType === 'redhat-container-image') {
      indexName = 'redhat-container-image';
    }
  } else if (artifactConext === 'centos') {
    if (artifactType === 'koji-build-cs') {
      indexName = 'centos-rpm';
    } else if (artifactType === 'koji-build') {
      /**
       *   "topic": "org.centos.prod.ci.koji-build.test.running"
       *   "nvr": "glances-3.4.0-1.fc39",
       */
      indexName = 'fedora-rpm';
    }
  } else if (artifactConext === 'fedora') {
    if (artifactType === 'koji-build') {
      indexName = 'fedora-rpm';
    } else if (artifactType === 'fedora-module') {
      indexName = 'fedora-module';
    }
  } else if (artifactConext === 'any') {
    if (artifactType === 'invalid-messages') {
      indexName = 'invalid-messages';
    }
  }
  if (!indexName) {
    throw new Error(
      `Cannot get index name for artifact type: ${artifactType} and context: ${artifactConext}`,
    );
  }
  const prefix = cfg.loader.opensearch.indexes_prefix;
  return `${prefix}${indexName}`;
};

export interface Update {
  doc?: Document | ValidationErrorsDocument | {};
  docId: string;
  upsert?: Document;
  routing?: string;
  indexName: string;
  docAsUpsert: boolean;
}

export type TSearchable =
  /** Rpm */
  | (SearchableRpm | SearchableTestRpm | SearchableEtaRpm)
  /** Mbs */
  | (SearchableMbs | SearchableTestMbs)
  /** Compose */
  | (SearchableCompose | SearchableTestCompose)
  /** Container */
  | (SearchableContainerImage | SearchableTestContainerImage)
  /** Pull-request */
  | SearchableDistGitPR;

export type Document = TSearchable & DocumentBase;

export type DocumentBase = {
  /*
   * Reason to have fullText out of searchable:
   * that we can make a query on searchable.*
   * This will find strict matches.
   */
  msgFullText?: string;
  /** Used for parent-child mapping */
  artToMsgs: unknown;
  /** Gather all data without mapping under one entry */
  rawData?: {
    /** Document based on a message from messages-broker */
    message?: MessageData;
  };
  '@timestamp': number;
};

export interface MessageData {
  /** Broker message id */
  brokerMsgId: string;
  /**
   * Message headers.
   */
  brokerExtra?: any;
  /**
   * JSON document for message
   */
  brokerMsgBody: any;
  /** Broker topic */
  brokerMsgTopic: string;
}

/**
 * All documents are uniquelly identified by
 *
 * Parents:
 *
 * * artifact-type : string
 * * artifact-id : string
 *
 * Children:
 *
 * * message-id
 *
 * List here all possible artifact-types:
 *
 * https://pagure.io/greenwave/blob/master/f/conf/subject_types
 * https://gitlab.cee.redhat.com/gating/greenwave-playbooks/-/blob/master/roles/greenwave/files/subject_types.yaml
 */

export type ArtifactTypes =
  /**
   * Builds from https://koji.fedoraproject.org/
   */
  | 'koji-build'
  /**
   * Builds from https://copr.fedorainfracloud.org/
   */
  | 'copr-build'
  /**
   * Builds from https://brewweb.engineering.redhat.com/
   */
  | 'brew-build'
  /**
   * PR from https://src.osci.redhat.com/
   */
  | 'dist-git-pr'
  /**
   * MBS builds from https://mbs.engineering.redhat.com/
   */
  | 'redhat-module'
  | 'fedora-module'
  /**
   * Composes produced by http://odcs.engineering.redhat.com/
   */
  | 'productmd-compose'
  /**
   * Builds from https://kojihub.stream.centos.org/koji/
   */
  | 'koji-build-cs'
  /*
   * Containers produced by https://brewweb.engineering.redhat.com/
   */
  | 'redhat-container-image';

export interface ValidationErrorsDocument {
  /** timestamp */
  '@timestamp': string;
  /** Error message */
  errmsg: Joi.ValidationErrorItem[] | string;
  /** Message from broker */
  brokerMsg: any;
  /** Broker topic */
  brokerTopic: string;
  /** Broker message id */
  brokerMsgId: string;
}

interface SearchableTest {
  /**
   * thread_id is copied thread_id from message or generated by KAI.
   */
  threadId: string;
  /**
   * Create, if possible, test case name.
   * The same name will have resultsdb:
   * https://pagure.io/fedora-ci/messages/blob/master/f/mappings/results/brew-build.test.complete.yaml#_5
   *
   *    name: "${body.test.namespace}.${body.test.type}.${body.test.category}"
   *
   * https://pagure.io/fedora-ci/messages/blob/master/f/schemas/test-common.yaml#_52
   *
   */
  testCaseName?: string;
  /**
   * stage can be: 'build', 'dispatch', 'test', 'promote', etc....
   * derived from topic
   * stage (in standard called as `event`) is always the second item from the end of the topic
   * Examples:
   *
   * * pull-request.test.error -> test
   * * brew-build.promote.error -> promote
   **/
  msgStage: string;
  /**
   * state is always the latest part of the message
   * Examples:
   *
   *  * brew-build.promote.error -> error
   *  * brew-build.test.complete -> complete
   */
  msgState: string;
  /** Broker message id */
  brokerMsgId: string;
  /** Broker topic */
  brokerTopic: string;
}

/**
 * RPM -> Build -> TaskId ->
 *                        -> TaskId
 *                        -> TaskId
 *                        -> TaskId
 *
 *
 * Scratch RPM -> TaskID
 */
export interface SearchableRpm {
  /** 0ad-0.0.23b-13.fc33 */
  nvr: string;
  /** Example: copr-build */
  aType: ArtifactTypes;
  /** owner of the build */
  issuer: string;
  /** task id */
  taskId: string;
  /**
   * git://pkgs.devel.redhat.com/rpms/navilu-fonts?#937e7b088e82736a62d0b21cbb0f2e1299400b2e
   * Source can be unknown in some cases, such as in messages from Errata Automation.
   */
  source?: string;
  scratch?: boolean;
  /**
   * Scratch has only taskId
   */
  buildId?: string;
  /**
   * Gating tag. Example: rhel-8.1.0-gate
   */
  gateTag?: string;
  /** name from .spec file */
  component: string;
  brokerMsgIdGateTag?: string;
}

export interface SearchableEtaRpm extends SearchableRpm {
  brokerTopic: string;
  brokerMsgId: string;
  etaCiRunUrl: string;
  etaCiRunOutcome: string;
  etaCiRunExplanation: string;
}

export interface SearchableTestRpm extends SearchableRpm, SearchableTest {}

export interface SearchableMbs {
  nvr: string;
  nsvc: string;
  /** Example: copr-build */
  aType: ArtifactTypes;
  mbsId: string;
  issuer: string;
  source?: string;
  scratch?: boolean;
  modName: string;
  gateTag?: string;
  modStream: string;
  modVersion: string;
  modContext: string;
  brokerMsgIdGateTag?: string;
}

export interface SearchableTestMbs extends SearchableMbs, SearchableTest {}

export interface SearchableCompose {
  aType: ArtifactTypes;
  composeId: string;
  /** nightly */
  composeType: string;
  composeReleaseType?: string;
}

export interface SearchableTestCompose
  extends SearchableCompose,
    SearchableTest {}

export interface SearchableContainerImage {
  aType: ArtifactTypes;
  /*
   * https://pagure.io/fedora-ci/messages/blob/master/f/schemas/redhat-container-image.yaml
   */
  /** mirror-registry-container-v1.2.8-3 */
  nvr: string;
  /** task id */
  taskId: number;
  /** owner of the build */
  issuer: string;
  /** name from nvr */
  component: string;
  /** true or false or */
  scratch: boolean;
  /**
   * git://pkgs.devel.redhat.com/rpms/navilu-fonts?#937e7b088e82736a62d0b21cbb0f2e1299400b2e
   */
  source?: string;
  /*
   * Brew build ID of container
   */
  buildId?: number;
  /*
   * A digest that uniquely identifies the image within a repository.
   * Example: sha256:67dad89757a55bfdfabec8abd0e22f8c7c12a1856514726470228063ed86593b
   */
  contId: string;
  contTag?: string;
  contName?: string;
  contFullNames: string[];
  contNamespace?: string;
  contRegistryUrl?: string;
  /*
   * Entries come from: VirtualTopic.eng.brew.build.complete
   * https://datagrepper.engineering.redhat.com/raw?topic=/topic/VirtualTopic.eng.brew.build.complete&delta=86400&contains=container_build
   */
  osbsSubtypes?: string[];
  brokerMsgIdBuildComplete?: string;
}

export interface SearchableTestContainerImage
  extends SearchableContainerImage,
    SearchableTest {}

export interface SearchableDistGitPR {
  uid: string;
  issuer: string;
  commentId: string;
  repository: string;
  commitHash: string;
}

export class OpensearchDocumentError extends Error {
  constructor(m: string) {
    super(m);
    /**
     * Set the prototype explicitly.
     */
    Object.setPrototypeOf(this, OpensearchDocumentError.prototype);
  }
}

export const printify = (obj: any): string => {
  var cache: any[] = [];
  function circular_ok(_key: string, value: any) {
    if (typeof value === 'object' && value !== null) {
      if (cache.indexOf(value) !== -1) {
        return;
      }
      cache.push(value);
    }
    return value;
  }
  /** JSON.stringify does not preserve any of the not-owned properties and not-enumerable properties of the object */
  return JSON.stringify(
    _.defaultsDeep(_.toPlainObject(obj), [
      _.pick(obj, Object.getOwnPropertyNames(obj)),
    ]),
    circular_ok,
    2,
  );
};

const mkInvalidMsgUpdate = (
  fqMsg: FileQueueMessage,
  err:
    | WrongVersionError
    | AJVValidationError
    | Joi.ValidationError
    | NoValidationSchemaError
    | NoAssociatedHandlerError,
): Update => {
  let brokerMsg = printify(fqMsg.body);
  const size: number = Buffer.byteLength(brokerMsg, 'utf8');
  if (size > 17800000) {
    brokerMsg = 'Message is bigger then 16Mb. Cannot store.';
  }
  const updateDoc: ValidationErrorsDocument = {
    '@timestamp': new Date().toISOString(),
    brokerMsg,
    errmsg: err instanceof Joi.ValidationError ? err.details : err.message,
    brokerTopic: fqMsg.broker_topic,
    brokerMsgId: fqMsg.broker_msg_id,
  };
  const docId = fqMsg.broker_msg_id;
  const indexName = getIndexName('any', 'invalid-messages');
  const update: Update = {
    docId,
    indexName,
    doc: updateDoc,
    docAsUpsert: true,
  };
  return update;
};

export const getMsgUpdates = async (
  fqMsg: FileQueueMessage,
): Promise<Update[]> => {
  const { broker_topic, broker_msg_id } = fqMsg;
  /**
   * Verify for correctness of input message with associated schema.
   */
  let updates: Update[] = [];
  try {
    await assertMsgIsValid(fqMsg);
    const handler = getHandler(broker_topic);
    log(" [I] '%s', %s", broker_topic, broker_msg_id);
    if (_.isUndefined(handler)) {
      const metric_name = 'handler-' + broker_topic;
      log(' [E] No handler for topic: %s', broker_topic);
      const errmsg = `broker msg-id: ${broker_msg_id}: does not have associated handler for topic '${broker_topic}'.`;
      throw new NoAssociatedHandlerError(errmsg, broker_topic);
    }
    updates = await handler(fqMsg);
  } catch (err) {
    if (
      err instanceof WrongVersionError ||
      err instanceof AJVValidationError ||
      err instanceof Joi.ValidationError ||
      err instanceof NoValidationSchemaError ||
      err instanceof NoAssociatedHandlerError
    ) {
      log(
        ' [E] Validation error. Store message to special index. Message with broker msg-id: %s and file-queue message-id: %s.\nValidation error: %s.\n',
        fqMsg.broker_msg_id,
        fqMsg.fq_msg_id,
        err.message,
      );
      const update: Update = mkInvalidMsgUpdate(fqMsg, err);
      updates = [update];
    } else if (err instanceof NoNeedToProcessError) {
      /**
       * Do nothing with message
       */
      log(
        ' [i] Drop message as requested. Message with broker msg-id: %s and file-queue message-id: %s.\nReason: %s.\n',
        fqMsg.broker_msg_id,
        fqMsg.fq_msg_id,
        err.message,
      );
    } else {
      throw err;
    }
  }
  return updates;
};

export class OpensearchClient {
  public client?: Client;
  private clientOptions: ClientOptions;

  constructor() {
    const config = cfg.loader.opensearch;
    this.clientOptions = config.client;
    this.client = new Client(this.clientOptions);
  }

  log(s: string, ...args: any[]): void {
    const msg = ` [I] ${s}`;
    log(msg, ...args);
  }

  fail(s: string, ...args: any[]): void {
    const msg = ` [E] ${s}`;
    log(msg, ...args);
  }

  async init(): Promise<void> {
    try {
      assert.ok(this.client, 'Opensearch client is empty.');
    } catch (err) {
      await this.client?.close();
      throw err;
    }
  }

  async bulkUpdate(updates: Update[]): Promise<void> {
    if (_.isUndefined(this.client)) {
      throw new Error('Connection is not initialized');
    }
    log(' [I] Send bulk with %s updates(s).', updates.length);
    try {
      const body = _.flatMap(updates, (update) => [
        {
          update: {
            _index: update.indexName,
            _id: update.docId,
            routing: update.routing,
          },
        },
        {
          doc: update.doc,
          upsert: update.upsert,
          doc_as_upsert: update.docAsUpsert,
        },
      ]);
      const { body: response } = await this.client.bulk({ body });
      if (response.errors !== false) {
        /** Use printify() to get errors meaning. */
        log(' [E] Result of bulk action: %O', printify(response));
        throw new Error('Error in bulk operation.');
      }
      log(' [I] bulk operation is successfull.');
    } catch (err) {
      this.fail('Bulk update failed.');
      throw err;
    }
  }

  async close(): Promise<void> {
    await this.client?.close();
  }
}
