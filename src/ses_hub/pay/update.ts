import * as functions from 'firebase-functions';
import { algolia } from '../../_algolia';
import { db, location, runtime, converter } from '../../_firebase';
import { userAuthenticated } from './_userAuthenticated';
import * as Firestore from '../../types/firestore';
import { log } from '../../_utils';
import { send } from '../../_sendgrid';
import * as body from '../mail';

type Status = 'active' | 'trialing' | 'canceled';

export const updatePlan = functions
  .region(location)
  .runWith(runtime)
  .firestore.document('customers/{uid}/subscriptions/{sub}')
  .onUpdate(async (change, context) => {
    await userAuthenticated(context.params.uid);

    const subscription = change.after.data() as Firestore.Subscription;

    const status: Status =
      subscription.status === 'active' || subscription.status === 'trialing'
        ? subscription.status
        : 'canceled';
    const price = subscription.items[0].plan.id;
    const start = subscription.current_period_start.seconds * 1000;
    const end = subscription.current_period_end.seconds * 1000;
    const cancel = subscription.canceled_at ? true : false;
    const remove = subscription.ended_at ? true : false;

    const plan = subscription.items[0].price.product.metadata.name === 'plan';
    const parent =
      subscription.items[0].price.product.metadata.type === 'parent';
    const account = subscription.items[0].price.metadata.account;

    checkPlan(plan);

    await checkDuplicate(context, remove, price);

    const children = parent ? await fetchChildren(context) : undefined;

    const { users } = await updateFirestore({
      context,
      status,
      cancel,
      price,
      parent,
      start,
      end,
      account,
      children,
    });

    if (status === 'canceled') {
      await updateAlgolia(context, children);
    }

    if (remove) {
      await deletePlan(context);
      await sendMail({ subscription, users });
    }

    await log({
      auth: { collection: 'companys', doc: context.auth?.uid },
      run: 'updatePlan',
      code: 200,
    });

    return;
  });

export const updateOption = functions
  .region(location)
  .runWith(runtime)
  .firestore.document('customers/{uid}/subscriptions/{sub}')
  .onUpdate(async (change, context) => {
    await userAuthenticated(context.params.uid);

    const subscription = change.after.data() as Firestore.Subscription;

    const status: Status =
      subscription.status === 'active' || subscription.status === 'trialing'
        ? subscription.status
        : 'canceled';
    const price = subscription.items[0].plan.id;
    const remove = subscription.ended_at ? true : false;

    const metadata = subscription.items[0].price.product.metadata;
    const option = metadata.name === 'option';
    const type = metadata.type;

    checkOption(option);
    checkCancel(status);

    await checkDuplicate(context, remove, price, type);

    const children = await fetchChildren(context);

    const { users } = await updateFirestore({ context, type, children });
    await updateAlgolia(context, children, type);

    if (remove) {
      await deleteOption(context);
      await sendMail({ subscription, users });
    }

    await log({
      auth: { collection: 'companys', doc: context.auth?.uid },
      run: 'updateOption',
      code: 200,
    });

    return;
  });

const sendMail = async ({
  subscription,
  users,
}: {
  subscription: Firestore.Subscription;
  users: Firestore.Company[];
}) => {
  const metadata = subscription.items[0].price.product.metadata;
  const type = metadata.name;
  const name =
    type === 'plan'
      ? subscription.items[0].price.nickname
      : metadata.type === 'analytics'
      ? 'アナリティクス'
      : 'フリーランスダイレクト';
  const start = subscription.current_period_start;
  const end = subscription.current_period_end;

  const to = functions.config().admin.ses_hub as string;
  const from = `SES_HUB <${functions.config().admin.ses_hub}>`;
  const subject = `SES_HUB ${
    type === 'plan' ? 'プラン' : 'オプション'
  }解約のお知らせ`;
  const text = body.pay.admin('解約', type, name, start, end, users);

  const mail = {
    to,
    from,
    subject,
    text,
  };

  await send(mail);
};

const fetchChildren = async (
  context: functions.EventContext,
): Promise<string[] | undefined> => {
  const doc = await db
    .collection('companys')
    .withConverter(converter<Firestore.Company>())
    .doc(context.params.uid)
    .get()
    .catch(() => {
      throw new functions.https.HttpsError(
        'not-found',
        'ユーザーの取得に失敗しました',
        'firebase',
      );
    });

  const children = doc.data()?.payment?.children;

  if (children) {
    return children;
  }

  return;
};

const deletePlan = async (context: functions.EventContext): Promise<void> => {
  await db
    .collection('customers')
    .withConverter(converter<Firestore.Customer>())
    .doc(context.params.uid)
    .collection('subscriptions')
    .withConverter(converter<Firestore.Subscription>())
    .doc(context.params.sub)
    .delete()
    .catch(() => {
      throw new functions.https.HttpsError(
        'data-loss',
        'ドキュメントの削除に失敗しました',
        'firebase',
      );
    });

  return;
};

const deleteOption = async (context: functions.EventContext): Promise<void> => {
  await db
    .collection('customers')
    .doc(context.params.uid)
    .collection('subscriptions')
    .doc(context.params.sub)
    .delete()
    .catch(() => {
      throw new functions.https.HttpsError(
        'data-loss',
        'ドキュメントの削除に失敗しました',
        'firebase',
      );
    });

  return;
};

const updateAlgolia = async (
  context: functions.EventContext,
  children?: string[],
  type?: string,
): Promise<void> => {
  await partialUpdateObject(context.params.uid, type);

  if (children?.length) {
    for await (const uid of children) {
      await partialUpdateObject(uid, type);
    }
  }

  return;
};

const partialUpdateObject = async (
  uid: string,
  type?: string,
): Promise<void> => {
  const index = algolia.initIndex('companys');
  const timestamp = Date.now();

  await index
    .partialUpdateObject(
      !type
        ? {
            objectID: uid,
            plan: 'disable',
            updateAt: timestamp,
          }
        : {
            objectID: uid,
            [type]: 'disable',
            updateAt: timestamp,
          },
      {
        createIfNotExists: false,
      },
    )
    .catch(() => {
      throw new functions.https.HttpsError(
        'data-loss',
        'プロフィールの更新に失敗しました',
        'algolia',
      );
    });

  return;
};

const updateFirestore = async ({
  context,
  type,
  status,
  cancel,
  price,
  parent,
  start,
  end,
  account,
  children,
}: {
  context: functions.EventContext;
  type?: string;
  status?: Status;
  cancel?: boolean;
  price?: string;
  parent?: boolean;
  start?: number;
  end?: number;
  account?: string;
  children?: string[];
}): Promise<{ users: Firestore.Company[] }> => {
  const users: Firestore.Company[] = [];

  const user = await updateDoc({
    uid: context.params.uid,
    type: type,
    status: status,
    cancel: cancel,
    price: price,
    start: start,
    end: end,
    parent: parent,
    account: account,
  });

  if (user) users.push(user);

  if (children?.length) {
    for await (const uid of children) {
      const user = await updateDoc({
        uid: uid,
        type: type,
        status: status,
        cancel: cancel,
        price: price,
        start: start,
        end: end,
        parent: parent,
        child: true,
        account: account,
      });

      if (user) users.push(user);
    }
  }

  return { users };
};

const updateDoc = async ({
  uid,
  type,
  status,
  cancel,
  price,
  start,
  end,
  parent,
  child,
  account,
}: {
  uid: string;
  type?: string;
  status?: string;
  cancel?: boolean;
  price?: string;
  start?: number;
  end?: number;
  parent?: boolean;
  child?: boolean;
  account?: string;
}): Promise<Firestore.Company | void> => {
  const doc = await db
    .collection('companys')
    .withConverter(converter<Firestore.Company>())
    .doc(uid)
    .get()
    .catch(() => {
      throw new functions.https.HttpsError(
        'not-found',
        'ユーザーの取得に失敗しました',
        'firebase',
      );
    });

  if (doc.exists) {
    const payment = doc.data()?.payment;
    const individual = !parent || child;
    const canceled = status === 'canceled';

    const option = type
      ? Object.assign(payment?.option ? payment.option : {}, {
          [type]: false,
        })
      : undefined;

    await doc.ref
      .set(
        {
          payment: Object.assign(
            payment ?? {},
            option
              ? {
                  option: option,
                  load: false,
                }
              : individual
              ? canceled
                ? {
                    status: status,
                    price: null,
                    start: null,
                    limit: payment?.status !== 'active' ? payment?.limit : 5,
                    end: null,
                    cancel: false,
                    notice: !child ? true : false,
                  }
                : {
                    status: status,
                    price: price,
                    start: start,
                    end: end,
                    cancel: cancel,
                  }
              : canceled
              ? {
                  status: status,
                  price: null,
                  start: null,
                  end: null,
                  account: 0,
                  cancel: false,
                  notice: true,
                }
              : {
                  status: status,
                  price: price,
                  account: Number(account),
                  start: start,
                  end: end,
                  cancel: cancel,
                },
          ),
        } as Partial<Firestore.Company>,
        { merge: true },
      )
      .catch(() => {
        throw new functions.https.HttpsError(
          'data-loss',
          'プロフィールの更新に失敗しました',
          'firebase',
        );
      });

    return doc.data() as Firestore.Company;
  }

  return;
};

const checkDuplicate = async (
  context: functions.EventContext,
  remove: boolean,
  price: string,
  type?: string,
): Promise<void> => {
  const subscriptions = await db
    .collection('customers')
    .withConverter(converter<Firestore.Customer>())
    .doc(context.params.uid)
    .collection('subscriptions')
    .withConverter(converter<Firestore.Subscription>())
    .get();

  const docs = subscriptions?.docs?.length;
  const doc = !type
    ? subscriptions?.docs?.filter(
        (doc) =>
          (doc.data().status === 'active' ||
            doc.data().status === 'trialing') &&
          doc.data().items[0].price.id !== price &&
          doc.data().items[0].price.product.metadata.name === 'plan',
      ).length
    : subscriptions?.docs?.filter(
        (doc) =>
          (doc.data().status === 'active' ||
            doc.data().status === 'trialing') &&
          doc.data().items[0].price.id !== price &&
          doc.data().items[0].price.product.metadata.name === 'option' &&
          doc.data().items[0].price.product.metadata.type === type,
      ).length;

  if (docs > 1 && doc && remove) {
    await db
      .collection('customers')
      .withConverter(converter<Firestore.Customer>())
      .doc(context.params.uid)
      .collection('subscriptions')
      .withConverter(converter<Firestore.Subscription>())
      .doc(context.params.sub)
      .delete()
      .then(() => {
        throw new functions.https.HttpsError(
          'cancelled',
          'ドキュメントを削除しました',
          'firebase',
        );
      })
      .catch(() => {
        throw new functions.https.HttpsError(
          'data-loss',
          'ドキュメントの削除に失敗しました',
          'firebase',
        );
      });
  } else if (docs > 1 && doc) {
    throw new functions.https.HttpsError(
      'cancelled',
      '他のプランが有効のため処理中止',
      'firebase',
    );
  }
};

const checkPlan = (plan: boolean): void => {
  if (!plan) {
    throw new functions.https.HttpsError(
      'cancelled',
      'プランの更新では無いので処理中止',
      'firebase',
    );
  }

  return;
};

const checkOption = (option: boolean): void => {
  if (!option) {
    throw new functions.https.HttpsError(
      'cancelled',
      'オプションの更新では無いので処理中止',
      'firebase',
    );
  }

  return;
};

const checkCancel = (status: Status): void => {
  if (status !== 'canceled') {
    throw new functions.https.HttpsError(
      'cancelled',
      '更新が無いので処理中止',
      'firebase',
    );
  }

  return;
};
