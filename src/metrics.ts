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

import _ from 'lodash';
import debug from 'debug';

const log = debug('kaijs:metrics');

export const metrics = {
  broker_messages: {
    ack: {},
    nack: {},
  },
  fq_messages: {
    total: 0,
    ack: 0,
    nack: 0,
  },
  parse: {
    err: {},
    ok: {},
  },
};

type MetricsBrokerAction = 'ack' | 'nack';
type MetricsFileQueueAction = 'ack' | 'nack';
type MetricsParseAction = 'err' | 'ok';

export function metrics_up_broker(
  routingKey: string,
  action: MetricsBrokerAction
): void {
  let current: number = _.get(metrics.broker_messages[action], routingKey, 0);
  current++;
  _.set(metrics.broker_messages[action], routingKey, current);
}

export function metrics_up_fq(action: MetricsFileQueueAction): void {
  metrics.fq_messages[action]++;
}

export function metrics_up_parse(
  schema_name: string,
  action: MetricsParseAction
) {
  let current: number = _.get(metrics.parse[action], schema_name, 0);
  current++;
  _.set(metrics.parse[action], schema_name, current);
}
