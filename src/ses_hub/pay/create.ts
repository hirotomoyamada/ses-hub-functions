import * as functions from 'firebase-functions';
import { algolia } from '../../_algolia';
import { converter, db, location, runtime } from '../../_firebase';
import { userAuthenticated } from './_userAuthenticated';
import * as Firestore from '../../types/firestore';
import { log } from '../../_utils';
import { send } from '../../_sendgrid';
import * as body from '../mail';

export const createPlan = functions
  .region(location)
  .runWith(runtime)
  .firestore.document('customers/{uid}/subscriptions/{sub}')
  .onCreate(async (snapshot, context) => {
    await userAuthenticated(context.params.uid);

    const subscriptionId = snapshot.id;
    const subscription = snapshot.data() as Firestore.Subscription;

    const metadata = subscription.items[0].price.product.metadata;

    const status = subscription.status;
    const price = subscription.items[0].plan.id;
    const start = subscription.current_period_start.seconds * 1000;
    const end = subscription.current_period_end.seconds * 1000;
    const plan = metadata.name === 'plan';

    const parent = metadata.type === 'parent';
    const account = subscription.items[0].price.metadata.account;

    checkPlan(plan);

    const children = parent ? await fetchChildren(context) : undefined;

    const { users } = await updateFirestore({
      context,
      subscriptionId,
      status,
      price,
      parent,
      start,
      end,
      children,
      account,
    });

    await updateAlgolia(context, children);
    await sendMail({ subscription, users });

    await log({
      auth: { collection: 'companys', doc: context.auth?.uid },
      run: 'createPlan',
      code: 200,
    });

    return;
  });

export const createOption = functions
  .region(location)
  .runWith(runtime)
  .firestore.document('customers/{uid}/subscriptions/{sub}')
  .onCreate(async (snapshot, context) => {
    await userAuthenticated(context.params.uid);

    const subscriptionId = snapshot.id;
    const subscription = snapshot.data() as Firestore.Subscription;

    const metadata = subscription.items[0].price.product.metadata;
    const option = metadata.name === 'option';
    const type = metadata.type;

    checkOption(option);

    const children = await fetchChildren(context);

    const { users } = await updateFirestore({ context, subscriptionId, type, children });
    await updateAlgolia(context, children, type);

    await sendMail({ subscription, users });

    await log({
      auth: { collection: 'companys', doc: context.auth?.uid },
      run: 'createOption',
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
  const name = type === 'plan' ? subscription.items[0].price.nickname : 'フリーランスダイレクト';
  const start = subscription.current_period_start;
  const end = subscription.current_period_end;

  const to = functions.config().admin.ses_hub as string;
  const from = `SES_HUB <${functions.config().admin.ses_hub}>`;
  const subject = `SES_HUB ${type === 'plan' ? 'プラン' : 'オプション'}契約のお知らせ`;
  const text = body.pay.admin('契約', type, name, start, end, users);

  const mail = {
    to,
    from,
    subject,
    text,
  };

  await send(mail);
};

const fetchChildren = async (context: functions.EventContext): Promise<string[] | undefined> => {
  const doc = await db
    .collection('companys')
    .withConverter(converter<Firestore.Company>())
    .doc(context.params.uid)
    .get()
    .catch(() => {
      throw new functions.https.HttpsError('not-found', 'ユーザーの取得に失敗しました', 'firebase');
    });

  const children = doc.data()?.payment?.children;

  if (children) {
    return children;
  }

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

const partialUpdateObject = async (uid: string, type?: string): Promise<void> => {
  const index = algolia.initIndex('companys');
  const timestamp = Date.now();

  await index
    .partialUpdateObject(
      !type
        ? {
            objectID: uid,
            plan: 'enable',
            updateAt: timestamp,
          }
        : {
            objectID: uid,
            [type]: 'enable',
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
  subscriptionId,
  type,
  status,
  price,
  parent,
  start,
  end,
  children,
  account,
}: {
  context: functions.EventContext;
  subscriptionId: string;
  type?: string;
  status?: string;
  price?: string;
  parent?: boolean;
  start?: number;
  end?: number;
  children?: string[];
  account?: string;
}): Promise<{ users: Firestore.Company[] }> => {
  const users: Firestore.Company[] = [];

  const user = await updateDoc({
    uid: context.params.uid,
    subscriptionId,
    type,
    status,
    price,
    start,
    end,
    parent,
    account,
  });

  if (user) users.push(user);

  if (children?.length) {
    for await (const uid of children) {
      const user = await updateDoc({
        uid,
        subscriptionId,
        type,
        status,
        price,
        start,
        end,
        parent,
        child: true,
        account,
      });

      if (user) users.push(user);
    }
  }

  return { users };
};

const updateDoc = async ({
  uid,
  subscriptionId,
  type,
  status,
  price,
  parent,
  child,
  account,
  start,
  end,
}: {
  uid: string;
  subscriptionId: string;
  type?: string;
  status?: string;
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
      throw new functions.https.HttpsError('not-found', 'ユーザーの取得に失敗しました', 'firebase');
    });

  if (doc.exists) {
    const payment = doc.data()?.payment;
    const individual = !parent || child;

    const children = !individual && payment?.children ? payment.children : [];

    const option = type
      ? Object.assign(payment?.option ? payment.option : {}, {
          [type]: true,
        })
      : undefined;

    const subscriptions = Object.assign(payment?.subscriptions ?? {}, {
      [!type ? 'plan' : type]: subscriptionId,
    });

    await doc.ref
      .set(
        {
          payment: Object.assign(
            payment ?? {},
            option
              ? {
                  option: option,
                  subscriptions,
                  load: false,
                }
              : individual
              ? {
                  status,
                  subscriptions,
                  price,
                  start,
                  end: end,
                  trial: false,
                  cancel: false,
                  notice: false,
                  load: false,
                }
              : {
                  status,
                  subscriptions,
                  price,
                  account: Number(account),
                  children,
                  start,
                  end,
                  trial: false,
                  cancel: false,
                  notice: false,
                  load: false,
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
