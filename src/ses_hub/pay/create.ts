import * as functions from "firebase-functions";
import { algolia } from "../../_algolia";
import { converter, db, location, runtime } from "../../_firebase";
import { userAuthenticated } from "./_userAuthenticated";
import * as Firestore from "../../types/firestore";
import { log } from "../../_utils";

export const createPlan = functions
  .region(location)
  .runWith(runtime)
  .firestore.document("customers/{uid}/subscriptions/{sub}")
  .onCreate(async (snapshot, context) => {
    await userAuthenticated(context.params.uid);

    const subscription = snapshot.data() as Firestore.Subscription;

    const metadata = subscription.items[0].price.product.metadata;

    const status = subscription.status;
    const price = subscription.items[0].plan.id;
    const start = subscription.current_period_start.seconds * 1000;
    const end = subscription.current_period_end.seconds * 1000;
    const plan = metadata.name === "plan";

    const parent = metadata.type === "parent";
    const account = subscription.items[0].price.metadata.account;

    checkPlan(plan);

    const children = parent ? await fetchChildren(context) : undefined;

    await updateFirestore({
      context,
      status,
      price,
      parent,
      start,
      end,
      children,
      account,
    });

    await updateAlgolia(context, children);

    await log({
      auth: { collection: "companys", doc: context.auth?.uid },
      run: "createPlan",
      code: 200,
    });

    return;
  });

export const createOption = functions
  .region(location)
  .runWith(runtime)
  .firestore.document("customers/{uid}/subscriptions/{sub}")
  .onCreate(async (snapshot, context) => {
    await userAuthenticated(context.params.uid);

    const subscription = snapshot.data() as Firestore.Subscription;

    const metadata = subscription.items[0].price.product.metadata;
    const option = metadata.name === "option";
    const type = metadata.type;

    checkOption(option);

    const children = await fetchChildren(context);

    await updateFirestore({ context, type, children });
    await updateAlgolia(context, children, type);

    await log({
      auth: { collection: "companys", doc: context.auth?.uid },
      run: "createOption",
      code: 200,
    });

    return;
  });

const fetchChildren = async (
  context: functions.EventContext
): Promise<string[] | undefined> => {
  const doc = await db
    .collection("companys")
    .withConverter(converter<Firestore.Company>())
    .doc(context.params.uid)
    .get()
    .catch(() => {
      throw new functions.https.HttpsError(
        "not-found",
        "ユーザーの取得に失敗しました",
        "firebase"
      );
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
  type?: string
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
  type?: string
): Promise<void> => {
  const index = algolia.initIndex("companys");
  const timestamp = Date.now();

  await index
    .partialUpdateObject(
      !type
        ? {
            objectID: uid,
            plan: "enable",
            updateAt: timestamp,
          }
        : {
            objectID: uid,
            [type]: "enable",
            updateAt: timestamp,
          },
      {
        createIfNotExists: false,
      }
    )
    .catch(() => {
      throw new functions.https.HttpsError(
        "data-loss",
        "プロフィールの更新に失敗しました",
        "algolia"
      );
    });

  return;
};

const updateFirestore = async ({
  context,
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
  type?: string;
  status?: string;
  price?: string;
  parent?: boolean;
  start?: number;
  end?: number;
  children?: string[];
  account?: string;
}): Promise<void> => {
  await updateDoc({
    uid: context.params.uid,
    type,
    status,
    price,
    start,
    end,
    parent,
    account,
  });

  if (children?.length) {
    for await (const uid of children) {
      await updateDoc({
        uid,
        type,
        status,
        price,
        start,
        end,
        parent,
        child: true,
        account,
      });
    }
  }

  return;
};

const updateDoc = async ({
  uid,
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
  type?: string;
  status?: string;
  price?: string;
  start?: number;
  end?: number;
  parent?: boolean;
  child?: boolean;
  account?: string;
}): Promise<void> => {
  const doc = await db
    .collection("companys")
    .withConverter(converter<Firestore.Company>())
    .doc(uid)
    .get()
    .catch(() => {
      throw new functions.https.HttpsError(
        "not-found",
        "ユーザーの取得に失敗しました",
        "firebase"
      );
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

    await doc.ref
      .set(
        {
          payment: Object.assign(
            payment,
            option
              ? {
                  option: option,
                  load: false,
                }
              : individual
              ? {
                  status,
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
                  price,
                  account: Number(account),
                  children,
                  start,
                  end,
                  trial: false,
                  cancel: false,
                  notice: false,
                  load: false,
                }
          ),
        },
        { merge: true }
      )
      .catch(() => {
        throw new functions.https.HttpsError(
          "data-loss",
          "プロフィールの更新に失敗しました",
          "firebase"
        );
      });
  }

  return;
};

const checkPlan = (plan: boolean): void => {
  if (!plan) {
    throw new functions.https.HttpsError(
      "cancelled",
      "プランの更新では無いので処理中止",
      "firebase"
    );
  }

  return;
};

const checkOption = (option: boolean): void => {
  if (!option) {
    throw new functions.https.HttpsError(
      "cancelled",
      "オプションの更新では無いので処理中止",
      "firebase"
    );
  }

  return;
};
