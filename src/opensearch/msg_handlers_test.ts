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

/**
 * Create a db-entry with schema: schema_db_artifact
 * Extract only required fields.
 * Store unmodified message at 'db_artifact.states[]'.
 * msg - passed schema_rpm_build_test_complete schema
 *
 * Example:
 *
 * https://apps.fedoraproject.org/datagrepper/raw?topic=org.centos.prod.ci.koji-build.test.complete&delta=127800
 *
 * Topics:
 *
 * * org.centos.prod.ci.koji-build.test.complete
 * * VirtualTopic.eng.ci.brew-build.test.complete
 * * VirtualTopic.eng.ci.*.brew-build.test.complete
 *
 * Supported versions: https://pagure.io/fedora-ci/messages/releases
 *
 * * 0.2.1
 *
 * This is not RPM build. This is Koji/Brew build, which could be also container build.
 *
 * https://brewweb.engineering.redhat.com/brew/api
 * https://koji.fedoraproject.org/koji/api
 *
 */

import _ from 'lodash';
import debug from 'debug';
import {
  Upsert,
  Document,
  getIndexName,
  SearchableTest,
  ArtifactContext,
  SearchableCompose,
  SearchableRedHatModule,
  SearchableFedoraModule,
  SearchableContainerImage,
} from './opensearch';
import {
  THandler,
  mkThreadId,
  isTestStage,
  THandlersSet,
  mkSearchable,
  TGetSearchable,
  makeMessageData,
  makeTestCaseName,
  TSearchableHandlersSet,
} from './msg_handlers';
import { FileQueueMessage } from '../fqueue';
import { assert_is_valid } from '../validation';

const log = debug('kaijs:msg_handlers_test');

/**
 * V1 - Schema for messages with version >= 1.0.0
 */
const mkSearchableRpmTestV1 = (fq_msg: FileQueueMessage): SearchableTest => {
  const { broker_topic, body, broker_extra, broker_msg_id } = fq_msg;
  const { artifact } = body;
  var thread_id = mkThreadId(fq_msg);
  var test_state = _.last(_.split(broker_topic, '.')) as string;
  var test_stage = _.nth(_.split(broker_topic, '.'), -2) as string;
  var timestamp = Date.parse(_.get(body, 'generated_at'));
  let test_case_name;
  if (isTestStage(broker_topic)) {
    test_case_name = makeTestCaseName(body);
  }
  const searchable: SearchableTest = {
    task_id: _.get(artifact, 'id'),
    type: _.get(artifact, 'type'),
    nvr: _.get(artifact, 'nvr'),
    source: _.get(artifact, 'source'),
    issuer: _.get(artifact, 'issuer'),
    scratch: _.get(artifact, 'scratch'),
    component: _.get(artifact, 'component'),
    thread_id,
    /** state: complete, running */
    test_state,
    /** stage: build, test */
    test_stage,
    msg_timestamp: timestamp || broker_extra.timestamp,
    test_case_name,
    broker_msg_id,
    broker_topic,
  };
  return searchable;
};

/**
 * https://pagure.io/fedora-ci/messages/blob/master/f/schemas/module-build.yaml
 */
const mkSearchableMbsTestV1 = (
  fq_msg: FileQueueMessage,
): SearchableRedHatModule | SearchableFedoraModule => {
  const { broker_topic, body, broker_extra, broker_msg_id } = fq_msg;
  const { artifact } = body;
  var thread_id = mkThreadId(fq_msg);
  var test_state = _.last(_.split(broker_topic, '.')) as string;
  var test_stage = _.nth(_.split(broker_topic, '.'), -2) as string;
  var timestamp = Date.parse(_.get(body, 'generated_at'));
  let test_case_name;
  if (isTestStage(broker_topic)) {
    test_case_name = makeTestCaseName(body);
  }
  const searchable = {
    mbs_id: _.get(artifact, 'id'),
    nvr: _.get(artifact, 'nvr'),
    issuer: _.get(artifact, 'issuer'),
    nsvc: _.get(artifact, 'nsvc'),
    name: _.get(artifact, 'name'),
    stream: _.get(artifact, 'stream'),
    version: _.get(artifact, 'version'),
    context: _.get(artifact, 'context'),
    thread_id,
    /** state: complete, running */
    test_state,
    /** stage: build, test */
    test_stage,
    msg_timestamp: timestamp || broker_extra.timestamp,
    test_case_name,
    broker_msg_id,
    broker_topic,
  };
  return searchable;
};

/**
 * https://pagure.io/fedora-ci/messages/blob/master/f/schemas/productmd-compose.yaml
 */
const mkSearchableComposeTestV1 = (body: any): SearchableCompose => {
  const { artifact } = body;
  const searchable = {
    compose_id: _.get(artifact, 'id'),
    compose_type: _.get(artifact, 'compose_type'),
    release_type: _.get(artifact, 'release_type'),
  };
  return searchable;
};

const mkParentDocId = (fq_msg: FileQueueMessage): string => {
  const { body } = fq_msg;
  const { artifact } = body;
  const type = artifact.type;
  const id = artifact.id;
  return `${type}-${id}`;
};

const mkSearchableContainerImageTestV1 = (
  fq_msg: FileQueueMessage,
): SearchableContainerImage => {
  const { broker_topic, body, broker_extra, broker_msg_id } = fq_msg;
  const { artifact } = body;
  var thread_id = mkThreadId(fq_msg);
  var test_state = _.last(_.split(broker_topic, '.')) as string;
  var test_stage = _.nth(_.split(broker_topic, '.'), -2) as string;
  var timestamp = Date.parse(_.get(body, 'generated_at'));
  let test_case_name;
  if (isTestStage(broker_topic)) {
    test_case_name = makeTestCaseName(body);
  }
  const searchable = {
    task_id: _.get(artifact, 'task_id'),
    nvr: _.get(artifact, 'nvr'),
    source: _.get(artifact, 'source'),
    issuer: _.get(artifact, 'issuer'),
    scratch: _.get(artifact, 'scratch'),
    component: _.get(artifact, 'component'),
    build_id: _.get(artifact, 'build_id'),
    /* A digest that uniquely identifies the image within a repository. */
    id: _.get(artifact, 'id'),
    name: _.get(artifact, 'name'),
    namespace: _.get(artifact, 'namespace'),
    full_names: _.get(artifact, 'full_names'),
    registry_url: _.get(artifact, 'registry_url'),
    tag: _.get(artifact, 'tag'),
    thread_id,
    /** state: complete, running */
    test_state,
    /** stage: build, test */
    test_stage,
    msg_timestamp: timestamp || broker_extra.timestamp,
    test_case_name,
    broker_msg_id,
    broker_topic,
  };
  return searchable;
};

/**
 * Declare set() from most specialized to most global regexes
 */

const searchableComposeTestHandlers: TSearchableHandlersSet = new Map<
  RegExp,
  TGetSearchable
>();

const searchableRpmTestHandlers: TSearchableHandlersSet = new Map<
  RegExp,
  TGetSearchable
>();

const searchableContainerImageTestHandlers: TSearchableHandlersSet = new Map<
  RegExp,
  TGetSearchable
>();

const searchableMbsTestHandlers: TSearchableHandlersSet = new Map<
  RegExp,
  TGetSearchable
>();

/**
 * Payload handlers are based on message version
 */
searchableRpmTestHandlers.set(/^.*$/, mkSearchableRpmTestV1);
searchableComposeTestHandlers.set(/^.*$/, mkSearchableComposeTestV1);
searchableContainerImageTestHandlers.set(
  /^.*$/,
  mkSearchableContainerImageTestV1,
);
searchableMbsTestHandlers.set(/^.*$/, mkSearchableMbsTestV1);

const handlerRpmTest = async (
  artifactContext: ArtifactContext,
  fq_msg: FileQueueMessage,
): Promise<Upsert[]> => {
  const { broker_msg_id, body } = fq_msg;
  const { artifact } = body;
  assert_is_valid(artifact, 'valid_artifact_issuer');
  /** used to make parent document ID */
  const docId = broker_msg_id;
  const artifact_type = artifact.type;
  const searchable = mkSearchable(fq_msg, searchableRpmTestHandlers);
  const parentDocId = mkParentDocId(fq_msg);
  const indexName: string = getIndexName(artifactContext, artifact_type);
  const messageData = makeMessageData(fq_msg);
  const upsertDoc: Document = {
    searchable,
    '@timestamp': 0,
    message: messageData,
    artifact_message: {
      name: 'message',
      parent: parentDocId,
    },
  };
  const routing = parentDocId;
  const upsert: Upsert = {
    docId,
    indexName,
    upsertDoc,
    routing,
  };
  log(' [i] handlerRpmTest updated doc: %s%o', '\n', upsert);
  return [upsert];
};

const handlerMbsTest = async (
  artifactContext: ArtifactContext,
  fq_msg: FileQueueMessage,
): Promise<Upsert[]> => {
  const { broker_msg_id, body } = fq_msg;
  const { artifact } = body;
  /** used to make parent document ID */
  const docId = broker_msg_id;
  const artifact_type = artifact.type;
  const searchable = mkSearchable(fq_msg, searchableMbsTestHandlers);
  const parentDocId = mkParentDocId(fq_msg);
  const indexName: string = getIndexName(artifactContext, artifact_type);
  const messageData = makeMessageData(fq_msg);
  const upsertDoc: Document = {
    searchable,
    '@timestamp': 0,
    message: messageData,
    artifact_message: {
      name: 'message',
      parent: parentDocId,
    },
  };
  const routing = parentDocId;
  const upsert: Upsert = {
    docId,
    indexName,
    upsertDoc,
    routing,
  };
  log(' [i] handlerMbsTest updated doc: %s%o', '\n', upsert);
  return [upsert];
};

const handlerComposeTest = async (
  artifactContext: ArtifactContext,
  fq_msg: FileQueueMessage,
): Promise<Upsert[]> => {
  const { broker_msg_id, body } = fq_msg;
  const { artifact } = body;
  const artifact_type = artifact.type;
  const searchable = mkSearchable(fq_msg, searchableComposeTestHandlers);
  /** used to make parent document ID */
  const docId = broker_msg_id;
  const parentDocId = mkParentDocId(fq_msg);
  const indexName: string = getIndexName(artifactContext, artifact_type);
  const messageData = makeMessageData(fq_msg);
  const upsertDoc: Document = {
    searchable,
    '@timestamp': 0,
    message: messageData,
    artifact_message: {
      name: 'message',
      parent: parentDocId,
    },
  };
  const routing = parentDocId;
  const upsert: Upsert = {
    docId,
    indexName,
    upsertDoc,
    routing,
  };
  log(' [i] handlerRpmTest updated doc: %s%o', '\n', upsert);
  return [upsert];
};

const handlerContainerImageTest = async (
  artifactContext: ArtifactContext,
  fq_msg: FileQueueMessage,
): Promise<Upsert[]> => {
  const { broker_msg_id, body } = fq_msg;
  const { artifact } = body;
  assert_is_valid(artifact, 'valid_artifact_issuer');
  /** used to make parent document ID */
  const docId = broker_msg_id;
  const artifact_type = artifact.type;
  const searchable = mkSearchable(fq_msg, searchableContainerImageTestHandlers);
  const parentDocId = mkParentDocId(fq_msg);
  const indexName: string = getIndexName(artifactContext, artifact_type);
  const messageData = makeMessageData(fq_msg);
  const upsertDoc: Document = {
    searchable,
    '@timestamp': 0,
    message: messageData,
    artifact_message: {
      name: 'message',
      parent: parentDocId,
    },
  };
  const routing = parentDocId;
  const upsert: Upsert = {
    docId,
    indexName,
    upsertDoc,
    routing,
  };
  log(' [i] handlerContainerImageTest updated doc: %s%o', '\n', upsert);
  return [upsert];
};

const handlerRpmTestRedhat: THandler = _.partial(handlerRpmTest, 'redhat');
const handlerRpmTestCentos: THandler = _.partial(handlerRpmTest, 'centos');
const handlerComposeTestCentos: THandler = _.partial(
  handlerComposeTest,
  'centos',
);
const handlerComposeTestRedhat: THandler = _.partial(
  handlerComposeTest,
  'redhat',
);
const handlerComposeBuildRedhat: THandler = _.partial(
  handlerComposeTest,
  'redhat',
);
const handlerContainerImageTestRedhat: THandler = _.partial(
  handlerContainerImageTest,
  'redhat',
);

const handlerMbsTestRedhat: THandler = _.partial(handlerMbsTest, 'redhat');
const handlerMbsTestFedora: THandler = _.partial(handlerMbsTest, 'fedora');

export const handlers: THandlersSet = new Map<RegExp, THandler>();

/**
 * https://apps.fedoraproject.org/datagrepper/raw?topic=org.centos.prod.ci.koji-build.test.complete&delta=127800
 * https://pagure.io/fedora-ci/messages/blob/master/f/schemas/brew-build.test.complete.yaml
 */
handlers.set(
  /^org.centos.prod.ci.koji-build.test.(complete|queued|running|error)$/,
  handlerRpmTestCentos,
);
handlers.set(
  /^VirtualTopic\.eng\.ci(\.[\w-]+)?\.(brew-build|koji-build)\.test\.(complete|queued|running|error)$/,
  handlerRpmTestRedhat,
);
/**
 * https://apps.fedoraproject.org/datagrepper/raw?topic=org.centos.prod.ci.productmd-compose.test.complete&delta=127800
 * https://pagure.io/fedora-ci/messages/blob/master/f/schemas/productmd-compose.test.complete.yaml
 * https://datagrepper.engineering.redhat.com/raw?topic=/topic/VirtualTopic.eng.ci.productmd-compose.test.complete&delta=127800
 */
handlers.set(
  /^org.centos.prod.ci.productmd-compose.test.(complete|queued|running|error)$/,
  handlerComposeTestCentos,
);
handlers.set(
  /^VirtualTopic\.eng\.ci(\.[\w-]+)?\.productmd-compose\.test\.(complete|queued|running|error)$/,
  handlerComposeTestRedhat,
);
/**
 * https://datagrepper.engineering.redhat.com/raw?topic=/topic/VirtualTopic.eng.ci.productmd-compose.build.complete&delta=127800
 */
handlers.set(
  /^VirtualTopic\.eng\.ci(\.[\w-]+)?\.productmd-compose\.build\.(complete|error)$/,
  handlerComposeBuildRedhat,
);
/**
 * https://datagrepper.engineering.redhat.com/raw?topic=/topic/VirtualTopic.eng.ci.productmd-compose.build.complete&delta=127800
 * https://dashboard.osci.redhat.com/#/artifact/productmd-compose/aid/Supp-9.0.0-RHEL-9-20201008.1
 */

/**
 * https://datagrepper.engineering.redhat.com/raw?topic=/topic/VirtualTopic.eng.ci.cvp.redhat-container-image.test.complete&delta=86400
 * https://pagure.io/fedora-ci/messages/blob/master/f/schemas/redhat-container-image.test.complete.yaml
 */
handlers.set(
  /^VirtualTopic\.eng\.ci(\.[\w-]+)?\.redhat-container-image\.test\.(complete|queued|running|error)$/,
  handlerContainerImageTestRedhat,
);

/**
 * https://apps.fedoraproject.org/datagrepper/raw?topic=org.centos.prod.ci.fedora-module.test.complete&delta=127800
 * https://pagure.io/fedora-ci/messages/blob/master/f/schemas/redhat-module.test.complete.yaml
 * https://datagrepper.engineering.redhat.com/raw?topic=/topic/VirtualTopic.eng.ci.redhat-module.test.complete&delta=127800
 */
handlers.set(
  /^org.centos.prod.ci.fedora-module.test.(complete|queued|running|error)$/,
  handlerMbsTestRedhat,
);
handlers.set(
  /^VirtualTopic\.eng\.ci(\.[\w-]+)?\.redhat-module\.test\.(complete|queued|running|error)$/,
  handlerMbsTestFedora,
);
