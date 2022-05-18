import * as functions from "firebase-functions";
import { converter, db, location, runtime } from "../../_firebase";
import * as Firestore from "../../types/firestore";
import { dummy, log, time as calcTime } from "../../_utils";
import { userAuthenticated } from "./_userAuthenticated";

type Data = {
  uid: string;
  span: "total" | "day" | "week" | "month";
};

type Collection =
  | "posts"
  | "histories"
  | "likes"
  | "outputs"
  | "entries"
  | "follows"
  | "distribution"
  | "approval";

type Sort = "self" | "others";

type Timestamp = { label: string; time: { start: number; end: number } };

type Analytics = {
  active: boolean;
  key: Collection;
  label: string;
  self?: number;
  others?: number;
  log: {
    label: string;
    self?: number;
    others?: number;
  }[];
};

export const fetchAnalytics = functions
  .region(location)
  .runWith(runtime)
  .https.onCall(async (data: Data, context) => {
    await userAuthenticated({
      uid: data.uid,
      context,
      canceled: true,
      child: true,
      option: "analytics",
    });

    const demo = checkDemo(context);

    const collections: { collection: Collection; label: string }[] = [
      { collection: "posts", label: "投稿" },
      { collection: "histories", label: "閲覧" },
      { collection: "likes", label: "いいね" },
      { collection: "outputs", label: "出力" },
      { collection: "entries", label: "お問い合わせ" },
      { collection: "follows", label: "フォロー" },
      { collection: "distribution", label: "商流" },
      { collection: "approval", label: "稟議速度" },
    ];

    const activities: Analytics[] = [];

    if (!demo) {
      for (const { collection, label } of collections) {
        const analytics: Analytics = {
          active: true,
          key: collection,
          label: label,
          self: undefined,
          others: undefined,
          log: [],
        };

        await fetchTotal(analytics, collection, data);

        await fetchLog(analytics, collection, data);

        activities.push(analytics);
      }
    } else {
      for (const { collection, label } of collections) {
        const analytics: Analytics = {
          active: true,
          key: collection,
          label,
          self: undefined,
          others: undefined,
          log: [],
        };

        createDummy(analytics, collection, data);

        activities.push(analytics);
      }
    }

    await log({
      auth: { collection: "companys", doc: context.auth?.uid },
      run: "fetchAnalytics",
      code: 200,
      uid: data.uid,
    });

    return activities;
  });

const createDummy = (
  analytics: Analytics,
  collection: Collection,
  data: Data
): Analytics => {
  const distribution = collection === "distribution";
  const approval = collection === "approval";

  if (!distribution && !approval) {
    const span = data.span;
    const day = span === "day";
    const max = day ? 7 : 6;

    analytics.self = dummy.num(99, 999);
    analytics.others = dummy.num(99, 999);

    for (let i = 0; i < max; i++) {
      const { label } = timestamp(i, span);

      const log: Analytics["log"][number] = {
        label: label,
        self: dummy.num(99),
        others: dummy.num(99),
      };

      analytics.log.push(log);
    }
  } else {
    const labels = distribution
      ? ["プライム", "二次請け", "三次請け", "営業支援", "その他"]
      : ["当日中", "翌営業日1日以内", "翌営業日3日以内", "不明"];

    for (const label of labels) {
      const log: Analytics["log"][number] = {
        label: label,
        self: dummy.num(99),
        others: dummy.num(99),
      };

      analytics.log.push(log);
    }
  }

  return analytics;
};

const fetchLog = async (
  analytics: Analytics,
  collection: Collection,
  data: Data
): Promise<void> => {
  const distribution = collection === "distribution";
  const approval = collection === "approval";

  if (distribution || approval) return;

  const span = data.span;
  const day = span === "day";
  const max = day ? 7 : 6;

  for (let i = 0; i < max; i++) {
    const { label, time } = timestamp(i, span);

    switch (collection) {
      case "posts": {
        const querySnapshot = await fetchCollectionGroup({
          collection,
          sort: "self",
          uid: data.uid,
          time,
        });

        const self = querySnapshot ? querySnapshot.docs.length : 0;

        const log: Analytics["log"][number] = {
          label,
          self,
          others: undefined,
        };

        analytics.log.push(log);

        continue;
      }

      default: {
        const querySnapshot = {
          self: await fetchCollectionGroup({
            collection,
            sort: "self",
            uid: data.uid,
            time,
          }),
          others: await fetchCollectionGroup({
            collection,
            sort: "others",
            uid: data.uid,
            time,
          }),
        };

        const self = querySnapshot.self ? querySnapshot.self.docs.length : 0;
        const others = querySnapshot.others
          ? querySnapshot.others.docs.length
          : 0;

        const log: Analytics["log"][number] = {
          label: label,
          self,
          others,
        };

        analytics.log.push(log);

        continue;
      }
    }
  }
};

const fetchTotal = async (
  analytics: Analytics,
  collection: Collection,
  data: Data
): Promise<void> => {
  const posts = collection === "posts";
  const distribution = collection === "distribution";
  const approval = collection === "approval";

  const sorts: Sort[] = ["self", "others"];

  for (const sort of sorts) {
    if (sort === "others") if (posts || distribution || approval) continue;

    const querySnapshot = await fetchCollectionGroup({
      collection,
      sort,
      uid: data.uid,
      span: data.span,
    });

    if (!querySnapshot) continue;

    if (!distribution && !approval) {
      const count = querySnapshot.docs.length;

      analytics[sort] = count;
    } else {
      const labels = distribution
        ? ["プライム", "二次請け", "三次請け", "営業支援", "その他"]
        : ["当日中", "翌営業日1日以内", "翌営業日3日以内", "不明"];

      for (const label of labels) {
        const self = querySnapshot.docs
          .map((doc) => {
            const data = doc.data();

            if (!("objectID" in data)) return;

            return label ===
              (collection === "distribution"
                ? data.distribution
                : data.approval)
              ? data.objectID
              : undefined;
          })
          ?.filter(
            (objectID): objectID is string => objectID !== undefined
          )?.length;

        const log: Analytics["log"][number] = {
          label,
          self,
          others: undefined,
        };

        analytics.log.push(log);
      }
    }
  }
};

const fetchCollectionGroup = async ({
  collection,
  sort,
  uid,
  span,
  time,
}: {
  collection: Collection;
  sort: Sort;
  uid: Data["uid"];
  span?: Data["span"];
  time?: Timestamp["time"];
}): Promise<void | FirebaseFirestore.QuerySnapshot<
  Firestore.Post | Firestore.User
>> => {
  switch (sort) {
    case "self": {
      const doc = db.collection("companys").doc(uid);

      switch (collection) {
        case "posts":
        case "distribution":
        case "approval": {
          switch (span) {
            case "total": {
              return await doc
                .collection("posts")
                .withConverter(converter<Firestore.Post>())
                .orderBy("createAt", "desc")
                .get()
                .catch(() => {});
            }

            default: {
              return await doc
                .collection("posts")
                .withConverter(converter<Firestore.Post>())
                .where(
                  "createAt",
                  ">=",
                  span ? calcTime(span).start : time ? time.start : undefined
                )
                .where(
                  "createAt",
                  "<=",
                  span ? calcTime(span).end : time ? time.end : undefined
                )
                .orderBy("createAt", "desc")
                .get()
                .catch(() => {});
            }
          }
        }

        default: {
          switch (span) {
            case "total": {
              switch (collection) {
                case "likes":
                case "histories": {
                  return await doc
                    .collection(collection)
                    .withConverter(converter<Firestore.Post | Firestore.User>())
                    .where("index", "in", ["matters", "resources"])
                    .orderBy("createAt", "desc")
                    .get()
                    .catch(() => {});
                }

                default: {
                  return await doc
                    .collection(collection)
                    .withConverter(converter<Firestore.Post | Firestore.User>())
                    .orderBy("createAt", "desc")
                    .get()
                    .catch(() => {});
                }
              }
            }

            default: {
              switch (collection) {
                case "likes":
                case "histories": {
                  return await doc
                    .collection(collection)
                    .withConverter(converter<Firestore.Post | Firestore.User>())
                    .where("index", "in", ["matters", "resources"])
                    .where(
                      "createAt",
                      ">=",
                      span
                        ? calcTime(span).start
                        : time
                        ? time.start
                        : undefined
                    )
                    .where(
                      "createAt",
                      "<=",
                      span ? calcTime(span).end : time ? time.end : undefined
                    )
                    .orderBy("createAt", "desc")
                    .get()
                    .catch(() => {});
                }

                default: {
                  return await doc
                    .collection(collection)
                    .withConverter(converter<Firestore.Post | Firestore.User>())
                    .where(
                      "createAt",
                      ">=",
                      span
                        ? calcTime(span).start
                        : time
                        ? time.start
                        : undefined
                    )
                    .where(
                      "createAt",
                      "<=",
                      span ? calcTime(span).end : time ? time.end : undefined
                    )
                    .orderBy("createAt", "desc")
                    .get()
                    .catch(() => {});
                }
              }
            }
          }
        }
      }
    }

    case "others": {
      const collectionGroup = db.collectionGroup(collection);

      switch (span) {
        case "total": {
          switch (collection) {
            case "likes":
            case "histories": {
              return await collectionGroup
                .withConverter(converter<Firestore.Post | Firestore.User>())
                .where("index", "in", ["matters", "resources"])
                .where("uid", "==", uid)
                .orderBy("createAt", "desc")
                .get()
                .catch(() => {});
            }

            default: {
              return await collectionGroup
                .withConverter(converter<Firestore.Post | Firestore.User>())
                .where("uid", "==", uid)
                .orderBy("createAt", "desc")
                .get()
                .catch(() => {});
            }
          }
        }

        default: {
          switch (collection) {
            case "likes":
            case "histories": {
              return await collectionGroup
                .withConverter(converter<Firestore.Post | Firestore.User>())
                .where("index", "in", ["matters", "resources"])
                .where("uid", "==", uid)
                .where(
                  "createAt",
                  ">=",
                  span ? calcTime(span).start : time ? time.start : undefined
                )
                .where(
                  "createAt",
                  "<=",
                  span ? calcTime(span).end : time ? time.end : undefined
                )
                .orderBy("createAt", "desc")
                .get()
                .catch(() => {});
            }

            default: {
              return await collectionGroup
                .withConverter(converter<Firestore.Post | Firestore.User>())
                .where("uid", "==", uid)
                .where(
                  "createAt",
                  ">=",
                  span ? calcTime(span).start : time ? time.start : undefined
                )
                .where(
                  "createAt",
                  "<=",
                  span ? calcTime(span).end : time ? time.end : undefined
                )
                .orderBy("createAt", "desc")
                .get()
                .catch(() => {});
            }
          }
        }
      }
    }

    default:
      return;
  }
};

const timestamp = (i: number, span: Data["span"]): Timestamp => {
  const timeZone = 60 * 60 * 9 * 1000;

  switch (span) {
    case "day": {
      const date = new Date(new Date().setHours(0, 0, 0, 0));
      const start = new Date(date.setDate(date.getDate() - i));
      const end = new Date(date.setHours(23, 59, 59, 999));

      const label = (() => {
        switch (i) {
          case 0:
            return `今日`;

          default:
            return `${start.getMonth() + 1}月${start.getDate()}日`;
        }
      })();

      const time = {
        start: start.getTime() - timeZone,
        end: end.getTime() - timeZone,
      };

      return { label, time };
    }

    case "week": {
      const date = new Date(
        new Date(new Date().setDate(new Date().getDate() - i * 7)).setHours(
          0,
          0,
          0,
          0
        )
      );
      const start = new Date(
        date.setDate(
          date.getDate() - (date.getDay() === 0 ? 6 : date.getDay() - 1)
        )
      );
      const end = new Date(
        new Date(date.setDate(start.getDate() + 6)).setHours(23, 59, 59, 999)
      );

      const label = (() => {
        switch (i) {
          case 0:
            return `今週`;

          default:
            return `${i}週間前`;
        }
      })();

      const time = {
        start: start.getTime() - timeZone,
        end: end.getTime() - timeZone,
      };

      return { label, time };
    }

    default: {
      const date = new Date(
        new Date(new Date().setDate(1)).setHours(0, 0, 0, 0)
      );
      const start = new Date(date.setMonth(date.getMonth() - i));
      const end = new Date(
        new Date(
          new Date(date.setMonth(date.getMonth() + 1)).setDate(0)
        ).setHours(23, 59, 59, 999)
      );

      const label = (() => {
        switch (i) {
          case 0:
            return `今月`;

          default:
            return `${start.getMonth() + 1}月`;
        }
      })();

      const time = {
        start: start.getTime() - timeZone,
        end: end.getTime() - timeZone,
      };

      return { label, time };
    }
  }
};

const checkDemo = (context: functions.https.CallableContext): boolean =>
  context.auth?.uid === functions.config().demo.ses_hub.uid;
