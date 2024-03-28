import { dummy } from '../../_utils';
import * as Algolia from '../../types/algolia';
import { Hit } from '@algolia/client-search';

export const auth = {
  matter: (hit: Algolia.Matter): Algolia.Matter => {
    return {
      display: hit.display,
      objectID: hit.objectID,
      title: hit.title,
      industry: hit.industry,
      position: hit.position,
      body: hit.body,
      location: hit.location,
      period: hit.period,
      costs: hit.costs,
      adjustment: hit.adjustment,
      times: hit.times,
      handles: hit.handles,
      tools: hit.tools,
      requires: hit.requires,
      prefers: hit.prefers,
      interviews: hit.interviews,
      remote: hit.remote,
      distribution: hit.distribution,
      span: hit.span,
      approval: hit.approval,
      note: hit.note,
      status: hit.status,
      memo: hit.memo,
      uid: hit.uid,
      createAt: hit.createAt,
      updateAt: hit.updateAt,
    };
  },
  resource: (hit: Algolia.Resource): Algolia.Resource => {
    return {
      display: hit.display,
      objectID: hit.objectID,
      roman: hit.roman,
      position: hit.position,
      sex: hit.sex,
      age: hit.age,
      body: hit.body,
      belong: hit.belong,
      station: hit.station,
      period: hit.period,
      costs: hit.costs,
      handles: hit.handles,
      tools: hit.tools,
      skills: hit.skills,
      parallel: hit.parallel,
      note: hit.note,
      status: hit.status,
      memo: hit.memo,
      uid: hit.uid,
      createAt: hit.createAt,
      updateAt: hit.updateAt,
    };
  },
};

export const other = {
  matter: (hit: Algolia.Matter, status: boolean): Algolia.Matter => {
    return {
      objectID: hit.objectID,
      title: hit.title,
      industry: hit.industry,
      position: hit.position,
      body: hit.body,
      location: hit.location,
      period: hit.period,
      costs:
        hit.costs.display === 'public'
          ? {
              display: hit.costs.display,
              min: hit.costs.min,
              max: hit.costs.max,
            }
          : {
              display: hit.costs.display,
              type: hit.costs.type,
            },
      adjustment: hit.adjustment,
      times: hit.times,
      handles: hit.handles,
      tools: hit.tools,
      requires: hit.requires,
      prefers: hit.prefers,
      interviews: status
        ? hit.interviews
        : {
            type: 'その他',
            count: '1',
            setting: '不明',
          },
      remote: hit.remote,
      distribution: status ? hit.distribution : 'その他',
      span: status ? hit.span : 'その他',
      approval: status ? hit.approval : '不明',
      note: status
        ? hit.note
        : 'Lorem ipsum dolor sit amet consectetur adipisicing elit. Sunt eum inventore qui rem quam? Nulla nesciunt fuga debitis animi nemo? Id eligendi reiciendis dolorum esse nisi enim, quis et quisquam.',
      status: hit.status === '成約' ? hit.status : undefined,
      uid: hit.uid,
      createAt: hit.createAt,
      updateAt: hit.updateAt,
    };
  },

  resource: (hit: Algolia.Resource, status: boolean): Algolia.Resource => {
    return {
      objectID: hit.objectID,
      roman: {
        firstName: hit.roman.firstName.substring(0, 1),
        lastName: hit.roman.lastName.substring(0, 1),
      },
      position: hit.position,
      sex: hit.sex,
      age: hit.age,
      body: hit.body,
      belong: hit.belong,
      station: status ? hit.station : '山田駅',
      period: hit.period,
      costs:
        hit.costs.display === 'public'
          ? {
              display: hit.costs.display,
              min: hit.costs.min,
              max: hit.costs.max,
            }
          : {
              display: hit.costs.display,
              type: hit.costs.type,
            },
      handles: hit.handles,
      tools: hit.tools,
      skills: hit.skills,
      parallel: status ? hit.parallel : 'なし',
      note: status
        ? hit.note
        : 'Lorem ipsum dolor sit amet consectetur adipisicing elit. Sunt eum inventore qui rem quam? Nulla nesciunt fuga debitis animi nemo? Id eligendi reiciendis dolorum esse nisi enim, quis et quisquam.',
      uid: hit.uid,
      status: hit.status === '成約' ? hit.status : undefined,
      createAt: hit.createAt,
      updateAt: hit.updateAt,
    };
  },

  company: (hit: Algolia.Company, demo: boolean): Algolia.CompanyItem => {
    return {
      uid: hit.objectID,
      type: undefined,
      status: undefined,
      profile: {
        name: !demo ? hit.name : dummy.name(),
        person: !demo ? (hit.person ? hit.person : '名無しさん') : dummy.person(),
        body: hit.body,
      },
      createAt: hit.createAt,
    };
  },

  person: (hit: Algolia.Person): Algolia.PersonItem => {
    return {
      uid: hit.objectID,
      request: undefined,
      profile: {
        state: hit.state,
        nickName: hit.nickName,
        position: hit.position,
        age: hit.age,
        sex: hit.sex,
        handles: hit.handles,
        costs: hit.costs,
        period: hit.period,
        location: hit.location,
        body: hit.body,
      },
      createAt: hit.createAt,
    };
  },
};

export const promotion = {
  matter: (hit: Hit<Algolia.Matter>): Algolia.MatterPromotion => {
    return {
      objectID: hit.objectID,
      title: hit.title,
      position: hit.position,
      body: hit.body,
      location: hit.location,
      costs:
        hit.costs.display === 'public'
          ? {
              display: hit.costs.display,
              min: hit.costs.min,
              max: hit.costs.max,
            }
          : {
              display: hit.costs.display,
              type: hit.costs.type,
            },
      adjustment: hit.adjustment,
      times: hit.times,
      handles: hit.handles,
      remote: hit.remote,
      uid: hit.uid,
      createAt: hit.createAt,
    };
  },

  resource: (hit: Hit<Algolia.Resource>): Algolia.ResourcePromotion => {
    return {
      objectID: hit.objectID,
      roman: {
        firstName: hit.roman.firstName.substring(0, 1),
        lastName: hit.roman.lastName.substring(0, 1),
      },
      position: hit.position,
      body: hit.body,
      belong: hit.belong,
      station: hit.station,
      period: hit.period,
      costs:
        hit.costs.display === 'public'
          ? {
              display: hit.costs.display,
              min: hit.costs.min,
              max: hit.costs.max,
            }
          : {
              display: hit.costs.display,
              type: hit.costs.type,
            },
      handles: hit.handles,
      uid: hit.uid,
      createAt: hit.createAt,
    };
  },
};
