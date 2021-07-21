const {
  paths_mongodb,
  paths_mongodb_pack_array,
  drop_empty_paths,
  path_mongodb_to_lodash,
} = require('./paths');
const _ = require('lodash');

function mk_update_set(present, newdata) {
  const paths_new = paths_mongodb_pack_array(newdata);
  const paths_present = paths_mongodb_pack_array(present);
  /**
   * Drop path that resolve to isNull or isUndefined
   */
  drop_empty_paths(paths_new, newdata);
  drop_empty_paths(paths_present, present);
  /**
   * Get paths:
   *
   *  * present in newdata, but absent in present
   * 	or
   *  * always takes path from newdata that resolves to array
   */
  const paths_update = _.differenceWith(
    paths_new,
    paths_present,
    /**
     * when to drop path
     */
    (new_path, old_path) => {
      const new_path_lodash = path_mongodb_to_lodash(new_path);
      const old_path_lodash = path_mongodb_to_lodash(old_path);
      const new_value = _.get(newdata, new_path_lodash);
      const old_value = _.get(present, old_path_lodash);
      const drop = _.isEqual(new_value, old_value);
      return drop;
    }
  );
  console.log('paths_new', paths_new);
  console.log('paths_present', paths_present);
  console.log('paths_update', paths_update);
  const pairs = _.map(
    paths_update,
    _.unary(_.over(_.identity, _.partial(_.get, newdata)))
  );
  return _.fromPairs(pairs);
}

const o1 = {
  array: ['a1', 'a2'],
  b: {
    b1: [1, 2, 3],
    b2: 'b2same',
    b3: 'b3',
    b4: [4, 5, 6, '3'],
    b5: {
      d1: [],
      d2: 3,
    },
  },
};

const o2 = {
  array: ['a1', 1, 'b1'],
  b: {
    b1: [1, 2, 3, 1],
    b2: 'b2same',
    b3: 'b3modified, but will be ignored',
    b7: 'b7newdata',
    b4: [4, 5, 6, '3'],
    b5: {
      d1: 'c',
      d2: 3,
      c: ['a'],
    },
  },
};

const update_set = mk_update_set(o1, o2);

console.log('o1', o1);
console.log('o2', o2);
console.log('update_set', update_set);

/**
       * 
      _.overEvery(
        _.flow(
          _.identity,
          path_mongodb_to_lodash,
          _.partial(_.get, newdata),
          _.negate(_.isArray)
        ),
        _.flow(
          _.nthArg(1),
          path_mongodb_to_lodash,
          _.partial(_.get, present),
          _.negate(_.isArray)
        ),
        _.isEqual
      )
       */
