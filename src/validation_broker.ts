/*
 * This file is part of kaijs

 * Copyright (c) 2021, 2022 Andrei Stepanov <astepano@redhat.com>
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
import * as v_1 from './validation_msg_v_1';
import * as v_0_1 from './validation_msg_v_0.1';

const log = debug('kaijs:validation_msg');

/**
 * https://github.com/sideway/joi/blob/v9.0.4/API.md
 * https://joi.dev/api/?v=17.4.0
 */

/**
 * https://fedora-fedmsg.readthedocs.io/en/latest/topics.html#buildsys
 * https://apps.fedoraproject.org/datagrepper/raw?topic=org.fedoraproject.prod.buildsys.tag&delta=127800
 * https://apps.fedoraproject.org/datagrepper/raw?topic=org.centos.prod.buildsys.tag&delta=12780
 */
const schema_koji_buildsys_tag = Joi.object({
  /** tag id */
  tag_id: Joi.number().integer().greater(0).required(),
  /** tag name */
  tag: Joi.string().required(),
  /** who set the tag */
  user: Joi.string().required(),
  /** owner of pkg-build */
  owner: Joi.string().required(),
  /** pkg-build id */
  build_id: Joi.number().integer().greater(0).required(),
  /** pkg-build name */
  name: Joi.string().required(),
  /** pkg-build version */
  version: Joi.string().required(),
  /** pkg-build release */
  release: Joi.string().required(),
});

/**
 * https://datagrepper.engineering.redhat.com/raw?topic=/topic/VirtualTopic.eng.brew.build.tag&delta=127800
 */
const schema_brew_build_tag_build = Joi.object({
  build_id: Joi.number().integer(),
  completion_time: Joi.date().iso(),
  completion_ts: Joi.date().timestamp(),
  creation_event_id: Joi.number().integer(),
  creation_time: Joi.date().iso(),
  creation_ts: Joi.date().timestamp(),
  extra: Joi.object({
    source: Joi.object({
      original_url: Joi.string().uri(),
    }),
  }),
  id: Joi.number().integer(),
  name: Joi.string().required(),
  nvr: Joi.string().required(),
  owner_id: Joi.number().integer(),
  owner_name: Joi.string().required(),
  package_id: Joi.number().integer(),
  package_name: Joi.string().required(),
  release: Joi.string().required(),
  source: Joi.string().uri(),
  start_time: Joi.date().iso(),
  start_ts: Joi.date().timestamp(),
  state: Joi.number().integer(),
  task_id: Joi.number().integer(),
  version: Joi.string().required(),
  volume_id: Joi.number().integer(),
  volume_name: Joi.string().required(),
});

const schema_brew_build_tag_tag = Joi.object({
  arches: Joi.string().allow('').required(),
  extra: Joi.object({}),
  id: Joi.number().integer(),
  locked: Joi.boolean().required(),
  maven_include_all: Joi.boolean().required(),
  maven_support: Joi.boolean().required(),
  name: Joi.string().required(),
  perm: Joi.string().required(),
  perm_id: Joi.number().integer(),
});

const schema_brew_build_tag_user = Joi.object({
  id: Joi.number().integer(),
  krb_principals: Joi.array().items(Joi.string()),
  name: Joi.string().required(),
  status: Joi.number().integer(),
  usertype: Joi.number().integer(),
});

/**
 * VirtualTopic.eng.brew.build.tag
 * https://datagrepper.engineering.redhat.com/raw?topic=/topic/VirtualTopic.eng.brew.build.tag&delta=127800
 */
const schema_brew_build_tag = Joi.object({
  build: schema_brew_build_tag_build.required(),
  force: Joi.boolean().required(),
  tag: schema_brew_build_tag_tag.required(),
  user: schema_brew_build_tag_user.required(),
});

const isV_1 = [/^0\.2\./, /^1\./];
const isV_0_1 = /^0\.1\./;
const isAny = Joi.any();
const schemaError = Joi.string().error(
  /**
   * We must throw an error with type Joi.ValidationError,
   * Then mesage will be stored to corresponded DB,
   * and loader can continue running.
   */
  new Joi.ValidationError(
    'Message has unsupported version',
    '',
    'broker message'
  )
);
const verRef = Joi.ref('.version');

/**
 * brew/koji build
 */
const schema_rpm_build_test_complete = Joi.alternatives().conditional(verRef, {
  switch: [
    {
      is: isV_1,
      then: v_1.schema_rpm_build_test_complete,
    },
    {
      is: isV_0_1,
      then: v_0_1.schema_rpm_build_test_complete,
    },
    {
      is: isAny,
      then: schemaError,
    },
  ],
});
const schema_rpm_build_test_error = Joi.alternatives().conditional(verRef, {
  switch: [
    {
      is: isV_1,
      then: v_1.schema_rpm_build_test_error,
    },
    {
      is: isV_0_1,
      then: v_0_1.schema_rpm_build_test_error,
    },
    {
      is: isAny,
      then: schemaError,
    },
  ],
});
const schema_rpm_build_test_queued = Joi.alternatives().conditional(verRef, {
  switch: [
    {
      is: isV_1,
      then: v_1.schema_rpm_build_test_queued,
    },
    {
      is: isV_0_1,
      then: v_0_1.schema_rpm_build_test_queued,
    },
    {
      is: isAny,
      then: schemaError,
    },
  ],
});
const schema_rpm_build_test_running = Joi.alternatives().conditional(verRef, {
  switch: [
    {
      is: isV_1,
      then: v_1.schema_rpm_build_test_running,
    },
    {
      is: isV_0_1,
      then: v_0_1.schema_rpm_build_test_running,
    },
    {
      is: isAny,
      then: schemaError,
    },
  ],
});

/**
 * redhat/fedora build
 */
const schema_module_test_complete = Joi.alternatives().conditional(verRef, {
  switch: [
    {
      is: isV_1,
      then: v_1.schema_module_test_complete,
    },
    {
      is: isAny,
      then: schemaError,
    },
  ],
});

const schema_module_test_error = Joi.alternatives().conditional(verRef, {
  switch: [
    {
      is: isV_1,
      then: v_1.schema_module_test_error,
    },
    {
      is: isAny,
      then: schemaError,
    },
  ],
});
const schema_module_test_queued = Joi.alternatives().conditional(verRef, {
  switch: [
    {
      is: isV_1,
      then: v_1.schema_module_test_queued,
    },
    {
      is: isAny,
      then: schemaError,
    },
  ],
});
const schema_module_test_running = Joi.alternatives().conditional(verRef, {
  switch: [
    {
      is: isV_1,
      then: v_1.schema_module_test_running,
    },
    {
      is: isAny,
      then: schemaError,
    },
  ],
});

/**
 * productmd-compose
 */
const schema_compose_test_complete = Joi.alternatives().conditional(verRef, {
  switch: [
    {
      is: isV_1,
      then: v_1.schema_compose_test_complete,
    },
    {
      is: isV_0_1,
      then: v_0_1.schema_compose_test_complete,
    },
    {
      is: isAny,
      then: schemaError,
    },
  ],
});
const schema_compose_test_error = Joi.alternatives().conditional(verRef, {
  switch: [
    {
      is: isV_1,
      then: v_1.schema_compose_test_error,
    },
    {
      is: isV_0_1,
      then: v_0_1.schema_compose_test_error,
    },
    {
      is: isAny,
      then: schemaError,
    },
  ],
});
const schema_compose_test_queued = Joi.alternatives().conditional(verRef, {
  switch: [
    {
      is: isV_1,
      then: v_1.schema_compose_test_queued,
    },
    {
      is: isV_0_1,
      then: v_0_1.schema_compose_test_queued,
    },
    {
      is: isAny,
      then: schemaError,
    },
  ],
});
const schema_compose_test_running = Joi.alternatives().conditional(verRef, {
  switch: [
    {
      is: isV_1,
      then: v_1.schema_compose_test_running,
    },
    {
      is: isV_0_1,
      then: v_0_1.schema_compose_test_running,
    },
    {
      is: isAny,
      then: schemaError,
    },
  ],
});

const schemas_cs_broker_messages = {
  /**
   * Centos-stream
   */
  /**
   * https://apps.fedoraproject.org/datagrepper/raw?topic=org.centos.prod.buildsys.tag&delta=12780
   * https://issues.redhat.com/browse/CS-314
   */
  'org.centos.prod.buildsys.tag': schema_koji_buildsys_tag,
};

const schemas_fedora_broker_messages = {
  /**
   * https://apps.fedoraproject.org/datagrepper/raw?topic=org.centos.prod.ci.koji-build.test.complete&delta=127800
   */
  'org.centos.prod.ci.koji-build.test.complete': schema_rpm_build_test_complete,
  /**
   * https://apps.fedoraproject.org/datagrepper/raw?topic=org.centos.prod.ci.koji-build.test.error&delta=127800
   */
  'org.centos.prod.ci.koji-build.test.error': schema_rpm_build_test_error,
  /**
   * https://apps.fedoraproject.org/datagrepper/raw?topic=org.centos.prod.ci.koji-build.test.queued&delta=127800
   */
  'org.centos.prod.ci.koji-build.test.queued': schema_rpm_build_test_queued,
  /**
   * https://apps.fedoraproject.org/datagrepper/raw?topic=org.centos.prod.ci.koji-build.test.running&delta=127800
   */
  'org.centos.prod.ci.koji-build.test.running': schema_rpm_build_test_running,
  /**
   * https://apps.fedoraproject.org/datagrepper/raw?topic=org.fedoraproject.prod.buildsys.tag&delta=127800
   */
  'org.fedoraproject.prod.buildsys.tag': schema_koji_buildsys_tag,
};

/**
 * https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Regular_Expressions
 */

const schemas_umb_broker_messages = {
  /**
   * https://datagrepper.engineering.redhat.com/raw?topic=/topic/VirtualTopic.eng.ci.brew-build.test.complete&delta=127800
   */
  '/^VirtualTopic\\.eng\\.ci(\\.[\\w-]+)?\\.brew-build\\.test\\.complete$/':
    schema_rpm_build_test_complete,
  /**
   * https://datagrepper.engineering.redhat.com/raw?topic=/topic/VirtualTopic.eng.ci.brew-build.test.error&delta=127800
   */
  '/^VirtualTopic\\.eng\\.ci(\\.[\\w-]+)?\\.brew-build\\.test\\.error$/':
    schema_rpm_build_test_error,
  /**
   * https://datagrepper.engineering.redhat.com/raw?topic=/topic/VirtualTopic.eng.ci.brew-build.test.queued&delta=127800
   */
  '/^VirtualTopic\\.eng\\.ci(\\.[\\w-]+)?\\.brew-build\\.test\\.queued$/':
    schema_rpm_build_test_queued,
  /**
   * https://datagrepper.engineering.redhat.com/raw?topic=/topic/VirtualTopic.eng.ci.brew-build.test.running&delta=127800
   */
  '/^VirtualTopic\\.eng\\.ci(\\.[\\w-]+)?\\.brew-build\\.test\\.running$/':
    schema_rpm_build_test_running,

  /**
   * https://datagrepper.engineering.redhat.com/raw?topic=/topic/VirtualTopic.eng.ci.redhat-module.test.complete&delta=127800
   */
  '/^VirtualTopic\\.eng\\.ci(\\.[\\w-]+)?\\.redhat-module\\.test\\.complete$/':
    schema_module_test_complete,
  /**
   * https://datagrepper.engineering.redhat.com/raw?topic=/topic/VirtualTopic.eng.ci.redhat-module.test.error&delta=127800
   */
  '/^VirtualTopic\\.eng\\.ci(\\.[\\w-]+)?\\.redhat-module\\.test\\.error$/':
    schema_module_test_error,
  /**
   * https://datagrepper.engineering.redhat.com/raw?topic=/topic/VirtualTopic.eng.ci.redhat-module.test.queued&delta=127800
   */
  '/^VirtualTopic\\.eng\\.ci(\\.[\\w-]+)?\\.redhat-module\\.test\\.queued$/':
    schema_module_test_queued,
  /**
   * https://datagrepper.engineering.redhat.com/raw?topic=/topic/VirtualTopic.eng.ci.redhat-module.test.running&delta=127800
   */
  '/^VirtualTopic\\.eng\\.ci(\\.[\\w-]+)?\\.redhat-module\\.test\\.running$/':
    schema_module_test_running,

  /**
   * https://datagrepper.engineering.redhat.com/raw?topic=/topic/VirtualTopic.eng.ci.redhat-module.test.complete&delta=127800
   */
  '/^VirtualTopic\\.eng\\.ci(\\.[\\w-]+)?\\.productmd-compose\\.test\\.complete$/':
    schema_compose_test_complete,
  /**
   * https://datagrepper.engineering.redhat.com/raw?topic=/topic/VirtualTopic.eng.ci.redhat-module.test.error&delta=127800
   */
  '/^VirtualTopic\\.eng\\.ci(\\.[\\w-]+)?\\.productmd-compose\\.test\\.error$/':
    schema_compose_test_error,
  /**
   * https://datagrepper.engineering.redhat.com/raw?topic=/topic/VirtualTopic.eng.ci.redhat-module.test.queued&delta=127800
   */
  '/^VirtualTopic\\.eng\\.ci(\\.[\\w-]+)?\\.productmd-compose\\.test\\.queued$/':
    schema_compose_test_queued,
  /**
   * https://datagrepper.engineering.redhat.com/raw?topic=/topic/VirtualTopic.eng.ci.redhat-module.test.running&delta=127800
   */
  '/^VirtualTopic\\.eng\\.ci(\\.[\\w-]+)?\\.productmd-compose\\.test\\.running$/':
    schema_compose_test_running,

  /**
   * https://datagrepper.engineering.redhat.com/raw?topic=/topic/VirtualTopic.eng.brew.build.tag&delta=127800
   */
  'VirtualTopic.eng.brew.build.tag': schema_brew_build_tag,
};

export const schemas_broker = _.merge(
  schemas_cs_broker_messages,
  schemas_umb_broker_messages,
  schemas_fedora_broker_messages
);

type SchemaName = keyof typeof schemas_broker;
