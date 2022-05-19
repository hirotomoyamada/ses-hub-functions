import * as functions from "firebase-functions";
import { converter, db, location, runtime } from "../_firebase";
import * as Firestore from "../types/firestore";
import { time as calcTime } from "../_utils";
import { userAuthenticated } from "./_userAuthenticated";

type Collection = {
  user:
    | "login"
    | "posts"
    | "histories"
    | "likes"
    | "outputs"
    | "entries"
    | "follows";
  post: "posts" | "position" | "distribution" | "approval" | "sex" | "age";
};

type Index = "matters" | "resources";

type Span = "total" | "day" | "week" | "month";

type Sort = "active" | "trialing" | "canceled" | "person";

type Timestamp = { label: string; time: { start: number; end: number } };

type Analytics = {
  user: {
    key: Collection["user"];
    label: string;
    active?: number;
    trialing?: number;
    canceled?: number;
    person?: number;
    log: {
      label: string;
      active?: number;
      trialing?: number;
      canceled?: number;
      person?: number;
    }[];
  };

  post: {
    key: Collection["post"];
    label: string;
    active?: number;
    log: {
      label: string;
      active: number;
      ratio?: number;
    }[];
  };
};

export const fetchUserDashBoard = functions
  .region(location)
  .runWith(runtime)
  .https.onCall(async ({ span }: { span: Span }, context) => {
    await userAuthenticated(context);

    const collections: { collection: Collection["user"]; label: string }[] = [
      { collection: "login", label: "ログイン" },
      { collection: "posts", label: "投稿" },
      { collection: "histories", label: "閲覧" },
      { collection: "likes", label: "いいね" },
      { collection: "outputs", label: "出力" },
      { collection: "entries", label: "お問い合わせ" },
      { collection: "follows", label: "フォロー" },
    ];

    const analysis: Analytics["user"][] = [];

    for await (const { collection, label } of collections) {
      const analytics: Analytics["user"] = {
        key: collection,
        label,
        active: undefined,
        trialing: undefined,
        canceled: undefined,
        person: undefined,
        log: [],
      };

      await fetchTotal.user(analytics, collection, span);

      await fetchLog.user(analytics, collection, span);

      analysis.push(analytics);
    }

    return analysis;
  });

export const fetchPostDashBoard = functions
  .region(location)
  .runWith(runtime)
  .https.onCall(
    async ({ index, span }: { index: Index; span: Span }, context) => {
      await userAuthenticated(context);

      const collections: { collection: Collection["post"]; label: string }[] =
        (() => {
          switch (index) {
            case "matters":
              return [
                { collection: "posts", label: "投稿" },
                { collection: "position", label: "ポジション" },
                { collection: "distribution", label: "商流" },
                { collection: "approval", label: "稟議速度" },
              ];

            case "resources":
              return [
                { collection: "posts", label: "投稿" },
                { collection: "position", label: "ポジション" },
                { collection: "sex", label: "性別" },
                { collection: "age", label: "年齢" },
              ];
          }
        })();

      const analysis: Analytics["post"][] = [];

      for await (const { collection, label } of collections) {
        const posts = collection === "posts";

        const analytics: Analytics["post"] = {
          key: collection,
          label,
          active: undefined,
          log: [],
        };

        await fetchTotal.post(analytics, collection, index, span);

        if (posts) await fetchLog.post(analytics, collection, index, span);

        analysis.push(analytics);
      }

      return analysis;
    }
  );

const fetchLog = {
  user: async (
    analytics: Analytics["user"],
    collection: Collection["user"],
    span: Span
  ): Promise<void> => {
    const day = span === "day";
    const max = (() => {
      switch (collection) {
        case "login":
          return day ? 14 : 12;

        default:
          return day ? 7 : 6;
      }
    })();

    for (let i = 0; i < max; i++) {
      const { label, time } = timestamp(i, span);

      switch (collection) {
        case "posts":
        case "outputs": {
          const querySnapshot = {
            active: await fetchCollectionGroup.user({
              collection,
              sort: "active",
              time,
            }),
            trialing: await fetchCollectionGroup.user({
              collection,
              sort: "trialing",
              time,
            }),
            canceled: await fetchCollectionGroup.user({
              collection,
              sort: "canceled",
              time,
            }),
          };

          const active = querySnapshot.active
            ? querySnapshot.active.docs.length
            : 0;
          const trialing = querySnapshot.trialing
            ? querySnapshot.trialing.docs.length
            : 0;
          const canceled = querySnapshot.canceled
            ? querySnapshot.canceled.docs.length
            : 0;

          const log: Analytics["user"]["log"][number] = {
            label,
            active,
            trialing,
            canceled,
            person: undefined,
          };

          analytics.log.push(log);

          continue;
        }

        case "login": {
          const querySnapshot = {
            active: await fetchCollectionGroup.user({
              collection,
              sort: "active",
              time,
            }),
            trialing: await fetchCollectionGroup.user({
              collection,
              sort: "trialing",
              time,
            }),
            canceled: await fetchCollectionGroup.user({
              collection,
              sort: "canceled",
              time,
            }),
            person: await fetchCollectionGroup.user({
              collection,
              sort: "person",
              time,
            }),
          };

          const active = querySnapshot.active
            ? querySnapshot.active.docs.filter(
                (current, i, others) =>
                  others.findIndex(
                    (other) => other.data().uid === current.data().uid
                  ) === i
              ).length
            : 0;
          const trialing = querySnapshot.trialing
            ? querySnapshot.trialing.docs.filter(
                (current, i, others) =>
                  others.findIndex(
                    (other) => other.data().uid === current.data().uid
                  ) === i
              ).length
            : 0;
          const canceled = querySnapshot.canceled
            ? querySnapshot.canceled.docs.filter(
                (current, i, others) =>
                  others.findIndex(
                    (other) => other.data().uid === current.data().uid
                  ) === i
              ).length
            : 0;
          const person = querySnapshot.person
            ? querySnapshot.person.docs.filter(
                (current, i, others) =>
                  others.findIndex(
                    (other) => other.data().uid === current.data().uid
                  ) === i
              ).length
            : 0;

          const log: Analytics["user"]["log"][number] = {
            label,
            active,
            trialing,
            canceled,
            person,
          };

          analytics.log.push(log);

          continue;
        }

        default: {
          const querySnapshot = {
            active: await fetchCollectionGroup.user({
              collection,
              sort: "active",
              time,
            }),
            trialing: await fetchCollectionGroup.user({
              collection,
              sort: "trialing",
              time,
            }),
            canceled: await fetchCollectionGroup.user({
              collection,
              sort: "canceled",
              time,
            }),
            person: await fetchCollectionGroup.user({
              collection,
              sort: "person",
              time,
            }),
          };

          const active = querySnapshot.active
            ? querySnapshot.active.docs.length
            : 0;
          const trialing = querySnapshot.trialing
            ? querySnapshot.trialing.docs.length
            : 0;
          const canceled = querySnapshot.canceled
            ? querySnapshot.canceled.docs.length
            : 0;
          const person = querySnapshot.person
            ? querySnapshot.person.docs.length
            : 0;

          const log: Analytics["user"]["log"][number] = {
            label,
            active,
            trialing,
            canceled,
            person,
          };

          analytics.log.push(log);

          continue;
        }
      }
    }
  },

  post: async (
    analytics: Analytics["post"],
    collection: Collection["post"],
    index: Index,
    span: Span
  ): Promise<void> => {
    const day = span === "day";
    const max = (() => {
      switch (collection) {
        case "posts":
          return day ? 14 : 12;

        default:
          return day ? 7 : 6;
      }
    })();

    for (let i = 0; i < max; i++) {
      const { label, time } = timestamp(i, span);

      const querySnapshot = await fetchCollectionGroup.post({
        collection,
        index,
        time,
      });

      const active = querySnapshot ? querySnapshot.docs.length : 0;

      const log: Analytics["post"]["log"][number] = {
        label,
        active,
      };

      analytics.log.push(log);

      continue;
    }
  },
};

const fetchTotal = {
  user: async (
    analytics: Analytics["user"],
    collection: Collection["user"],
    span: Span
  ): Promise<void> => {
    const posts = collection === "posts";
    const outputs = collection === "outputs";

    const sorts: Sort[] = ["active", "trialing", "canceled", "person"];

    await Promise.allSettled(
      sorts.map(async (sort) => {
        if (sort === "person") if (posts || outputs) return;

        const querySnapshot = await fetchCollectionGroup.user({
          collection,
          sort,
          span,
        });

        if (!querySnapshot) return;

        const count = (() => {
          switch (collection) {
            case "login":
              return querySnapshot.docs.filter(
                (current, i, others) =>
                  others.findIndex(
                    (other) => other.data().uid === current.data().uid
                  ) === i
              ).length;

            default:
              return querySnapshot.docs.length;
          }
        })();

        analytics[sort] = count;
      })
    );
  },

  post: async (
    analytics: Analytics["post"],
    collection: Collection["post"],
    index: Index,
    span: Span
  ): Promise<void> => {
    const posts = collection === "posts";

    const querySnapshot = await fetchCollectionGroup.post({
      collection,
      index,
      span,
    });

    if (!querySnapshot) return;

    if (posts) {
      const count = querySnapshot.docs.length;

      analytics.active = count;
    } else {
      const total = querySnapshot.docs.length;

      querySnapshot.forEach((doc) => {
        const data = doc.data()[collection];

        const label = ((): string => {
          const label = data !== null && data !== undefined ? data : "不明";

          switch (collection) {
            case "age":
              return `${label}歳`;

            default:
              return `${label}`;
          }
        })();

        const index = analytics.log.findIndex((d) => d.label === label);

        if (index < 0) {
          analytics.log.push({ label, active: 1 });
        } else {
          analytics.log[index].active += 1;
        }
      });

      analytics.log.forEach((log, i) => {
        analytics.log[i] = { ...log, ratio: log.active / total };
      });

      analytics.log.sort((a, b) => {
        if (a.active > b.active) return -1;
        if (a.active < b.active) return 1;

        return 0;
      });
    }
  },
};

const fetchCollectionGroup = {
  user: async ({
    collection,
    sort,
    span,
    time,
  }: {
    collection: Collection["user"];
    sort: Sort;
    span?: Span;
    time?: Timestamp["time"];
  }): Promise<void | FirebaseFirestore.QuerySnapshot<
    Firestore.Post | Firestore.User | Firestore.Log
  >> => {
    const collectionGroup = (() => {
      switch (collection) {
        case "login":
          return db.collectionGroup("logs");
        default:
          return db.collectionGroup(collection);
      }
    })();

    switch (collection) {
      case "login": {
        switch (span) {
          case "total": {
            return await collectionGroup
              .withConverter(converter<Firestore.Log>())
              .where("payment", "==", sort !== "person" ? sort : null)
              .where("code", "==", 200)
              .where("run", "==", "login")
              .orderBy("createAt", "desc")
              .get()
              .catch(() => {});
          }

          default: {
            return await collectionGroup
              .withConverter(converter<Firestore.Log>())
              .where("payment", "==", sort !== "person" ? sort : null)
              .where("code", "==", 200)
              .where("run", "==", "login")
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
            return await collectionGroup
              .withConverter(converter<Firestore.Post | Firestore.User>())
              .where("payment", "==", sort !== "person" ? sort : null)
              .orderBy("createAt", "desc")
              .get()
              .catch(() => {});
          }

          default: {
            return await collectionGroup
              .withConverter(converter<Firestore.Post | Firestore.User>())
              .where("payment", "==", sort !== "person" ? sort : null)
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
  },

  post: async ({
    collection,
    index,
    span,
    time,
  }: {
    collection: Collection["post"];
    index: Index;
    span?: Span;
    time?: Timestamp["time"];
  }): Promise<void | FirebaseFirestore.QuerySnapshot<Firestore.Post>> => {
    const collectionGroup = (() => {
      switch (collection) {
        default:
          return db.collectionGroup("posts");
      }
    })();

    switch (collection) {
      default: {
        switch (span) {
          case "total": {
            return await collectionGroup
              .withConverter(converter<Firestore.Post>())
              .where("index", "==", index)
              .orderBy("createAt", "desc")
              .get()
              .catch(() => {});
          }

          default: {
            return await collectionGroup
              .withConverter(converter<Firestore.Post>())
              .where("index", "==", index)
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
  },
};

const timestamp = (i: number, span: Span): Timestamp => {
  const location = new Date().toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
  });
  const timeZone = 60 * 60 * 9 * 1000;

  switch (span) {
    case "day": {
      const date = new Date(new Date(location).setHours(0, 0, 0, 0));
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
        new Date(
          new Date(location).setDate(new Date(location).getDate() - i * 7)
        ).setHours(0, 0, 0, 0)
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
        new Date(new Date(location).setDate(1)).setHours(0, 0, 0, 0)
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
