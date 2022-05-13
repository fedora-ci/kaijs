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

/**
 * Loose validation.
 *
 * Validation is based on msg_handlers_*
 *
 * For messages <  1.y.z resultsdb-loader skips strict validation.
 */

/**
 * https://github.com/sideway/joi/blob/v9.0.4/API.md
 * https://joi.dev/api/?v=17.4.0
 */

/**
 * https://pagure.io/fedora-ci/messages/blob/e3f4758ff5a0948cceb09d0b214690351e453e7c/f/schemas/rpm-build.yaml
 */
const schema_rpm_build = Joi.object({
  type: Joi.string().valid('koji-build', 'brew-build').required(),
  id: Joi.number().integer().greater(0).required(),
  nvr: Joi.string().required(),
  source: Joi.string(),
  issuer: Joi.string().required(),
  scratch: Joi.boolean().required(),
  component: Joi.string().required(),
});

/**
 * https://pagure.io/fedora-ci/messages/blob/e3f4758ff5a0948cceb09d0b214690351e453e7c/f/schemas/common.yaml
 */
const schema_common = Joi.object({
  type: Joi.string(),
  version: Joi.string(),
});

/**
 * https://apps.fedoraproject.org/datagrepper/raw?topic=org.centos.prod.ci.koji-build.test.complete&delta=127800
 * https://pagure.io/fedora-ci/messages/blob/e3f4758ff5a0948cceb09d0b214690351e453e7c/f/schemas/brew-build.test.complete.yaml
 */
export const schema_rpm_build_test_complete = Joi.object({
  artifact: schema_rpm_build.required(),
  version: schema_common.extract('version').required(),
});

/**
 * https://pagure.io/fedora-ci/messages/blob/e3f4758ff5a0948cceb09d0b214690351e453e7c/f/schemas/brew-build.test.error.yaml
 */
export const schema_rpm_build_test_error = Joi.object({
  artifact: schema_rpm_build.required(),
  version: schema_common.extract('version').required(),
});

/**
 * https://pagure.io/fedora-ci/messages/blob/e3f4758ff5a0948cceb09d0b214690351e453e7c/f/schemas/brew-build.test.queued.yaml
 */
export const schema_rpm_build_test_queued = Joi.object({
  artifact: schema_rpm_build.required(),
  version: schema_common.extract('version').required(),
});

/**
 * https://pagure.io/fedora-ci/messages/blob/e3f4758ff5a0948cceb09d0b214690351e453e7c/f/schemas/brew-build.test.running.yaml
 */
export const schema_rpm_build_test_running = Joi.object({
  artifact: schema_rpm_build.required(),
  version: schema_common.extract('version').required(),
});

/**
 * https://pagure.io/fedora-ci/messages/blob/master/f/schemas/productmd-compose.yaml
 */
const schema_productmd_compose = Joi.object({
  type: Joi.string().valid('productmd-compose').required(),
  id: Joi.string().required(),
  compose_type: Joi.string().required(),
  release_type: Joi.string(),
});

/**
 * https://pagure.io/fedora-ci/messages/blob/master/f/schemas/productmd-compose.test.complete.yaml
 * https://datagrepper.engineering.redhat.com/raw?topic=/topic/VirtualTopic.eng.ci.productmd-compose.test.complete&delta=127800
 */
export const schema_compose_test_complete = Joi.object({
  artifact: schema_productmd_compose.required(),
  version: schema_common.extract('version').required(),
});

/**
 * https://pagure.io/fedora-ci/messages/blob/master/f/schemas/productmd-compose.test.error.yaml
 * https://datagrepper.engineering.redhat.com/raw?topic=/topic/VirtualTopic.eng.ci.productmd-compose.test.error&delta=127800
 */
export const schema_compose_test_error = Joi.object({
  artifact: schema_productmd_compose.required(),
  version: schema_common.extract('version').required(),
});

/**
 * https://pagure.io/fedora-ci/messages/blob/master/f/schemas/productmd-compose.test.queued.yaml
 * https://datagrepper.engineering.redhat.com/raw?topic=/topic/VirtualTopic.eng.ci.productmd-compose.test.queued&delta=127800
 */
export const schema_compose_test_queued = Joi.object({
  artifact: schema_productmd_compose.required(),
  version: schema_common.extract('version').required(),
});

/**
 * https://pagure.io/fedora-ci/messages/blob/master/f/schemas/productmd-compose.test.running.yaml
 * https://datagrepper.engineering.redhat.com/raw?topic=/topic/VirtualTopic.eng.ci.productmd-compose.test.running&delta=127800
 */
export const schema_compose_test_running = Joi.object({
  artifact: schema_productmd_compose.required(),
  version: schema_common.extract('version').required(),
});

/**
 * https://pagure.io/fedora-ci/messages/blob/master/f/schemas/productmd-compose.build.complete.yaml
 * https://datagrepper.engineering.redhat.com/raw?topic=/topic/VirtualTopic.eng.ci.productmd-compose.build.complete&delta=127800
 */
export const schema_compose_build_complete = Joi.object({
  artifact: schema_productmd_compose.required(),
  version: schema_common.extract('version').required(),
});

/**
 * https://pagure.io/fedora-ci/messages/blob/master/f/schemas/productmd-compose.build.running.yaml
 * https://datagrepper.engineering.redhat.com/raw?topic=/topic/VirtualTopic.eng.ci.productmd-compose.build.running&delta=127800
 */
export const schema_compose_build_running = Joi.object({
  artifact: schema_productmd_compose.required(),
  version: schema_common.extract('version').required(),
});

/**
 * https://pagure.io/fedora-ci/messages/blob/master/f/schemas/productmd-compose.build.error.yaml
 * https://datagrepper.engineering.redhat.com/raw?topic=/topic/VirtualTopic.eng.ci.productmd-compose.build.error&delta=127800
 */
export const schema_compose_build_error = Joi.object({
  artifact: schema_productmd_compose.required(),
  version: schema_common.extract('version').required(),
});

/**
 * https://pagure.io/fedora-ci/messages/blob/master/f/schemas/module-build.yaml
 */
const schema_module_build = Joi.object({
  type: Joi.string().valid('fedora-module', 'redhat-module'),
  id: Joi.number().integer().greater(0).required(),
  nvr: Joi.string(),
  issuer: Joi.string().required(),
  nsvc: Joi.string().required(),
  name: Joi.string().required(),
  stream: Joi.string().required(),
  version: Joi.string().required(),
  context: Joi.string().required(),
  scratch: Joi.boolean(),
});

/**
 * https://pagure.io/fedora-ci/messages/blob/master/f/schemas/redhat-module.test.complete.yaml
 * https://datagrepper.engineering.redhat.com/raw?topic=/topic/VirtualTopic.eng.ci.redhat-module.test.complete&delta=127800
 */
export const schema_module_test_complete = Joi.object({
  artifact: schema_module_build.required(),
  version: schema_common.extract('version').required(),
});

/**
 * https://pagure.io/fedora-ci/messages/blob/master/f/schemas/redhat-module.test.error.yaml
 * https://datagrepper.engineering.redhat.com/raw?topic=/topic/VirtualTopic.eng.ci.redhat-module.test.error&delta=127800
 */
export const schema_module_test_error = Joi.object({
  artifact: schema_module_build.required(),
  version: schema_common.extract('version').required(),
});

/**
 * https://pagure.io/fedora-ci/messages/blob/master/f/schemas/redhat-module.test.queued.yaml
 * https://datagrepper.engineering.redhat.com/raw?topic=/topic/VirtualTopic.eng.ci.redhat-module.test.queued&delta=127800
 */
export const schema_module_test_queued = Joi.object({
  artifact: schema_module_build.required(),
  version: schema_common.extract('version').required(),
});

/**
 * https://pagure.io/fedora-ci/messages/blob/master/f/schemas/redhat-module.test.running.yaml
 * https://datagrepper.engineering.redhat.com/raw?topic=/topic/VirtualTopic.eng.ci.redhat-module.test.running&delta=127800
 */
export const schema_module_test_running = Joi.object({
  artifact: schema_module_build.required(),
  version: schema_common.extract('version').required(),
});
