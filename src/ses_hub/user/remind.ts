import * as functions from 'firebase-functions';
import { converter, db, location, runtime, timeZone } from '../../_firebase';
import { userAuthenticated } from './_userAuthenticated';
import * as Firestore from '../../types/firestore';
import { log } from '../../_utils';
import { send } from '../../_sendgrid';
import * as body from '../mail';

export const sendRemind = functions
  .region(location)
  .runWith(runtime)
  .pubsub.schedule('0 13 */2 * *')
  .timeZone(timeZone)
  .onRun(async () => {
    const { docs } = await db
      .collection('companys')
      .withConverter(converter<Firestore.Company>())
      .get();

    const url: string = functions.config().app.ses_hub.url;

    const timestamp = Date.now();
    const threeDaysAgo = timestamp - 3 * 24 * 60 * 60 * 1000;

    await Promise.allSettled(
      docs.map(async (doc) => {
        const data = doc.data();

        const { createAt, profile } = data;

        if (threeDaysAgo < createAt) return;

        const { docs } =
          (await doc.ref
            .collection('posts')
            .withConverter(converter<Firestore.Post>())
            .orderBy('createAt', 'desc')
            .limit(1)
            .get()
            .catch(() => {})) ?? {};

        const latestPostCreateAt = (docs ?? [])[0]?.data()?.createAt ?? 0;

        if (threeDaysAgo < latestPostCreateAt) return;

        const userMail = {
          to: profile.email,
          from: `SES_HUB <${functions.config().admin.ses_hub}>`,
          subject: 'SES_HUB 案件/人材情報ご登録のススメ',
          text: body.remind.user(url),
        };

        await send(userMail);

        await log({
          auth: { collection: 'companys', doc: doc.id },
          run: 'sendRemind',
          code: 200,
        });
      }),
    );
  });

export const enableRemind = functions
  .region(location)
  .runWith(runtime)
  .pubsub.schedule('0 13 * * *')
  .timeZone(timeZone)
  .onRun(async () => {
    const { docs } = await db
      .collection('companys')
      .withConverter(converter<Firestore.Company>())
      .get();

    const timestamp = Date.now();
    const threeDaysAgo = timestamp - 3 * 24 * 60 * 60 * 1000;

    await Promise.allSettled(
      docs.map(async (doc) => {
        const data = doc.data();

        const { createAt } = data;

        if (threeDaysAgo < createAt) return;

        const { docs } =
          (await doc.ref
            .collection('posts')
            .withConverter(converter<Firestore.Post>())
            .orderBy('createAt', 'desc')
            .limit(1)
            .get()
            .catch(() => {})) ?? {};

        const latestPostCreateAt = (docs ?? [])[0]?.data()?.createAt ?? 0;

        if (threeDaysAgo < latestPostCreateAt) return;

        await updateFiresotre(doc.id, 'enable');

        await log({
          auth: { collection: 'companys', doc: doc.id },
          run: 'enableRemind',
          code: 200,
        });
      }),
    );
  });

export const disableRemind = functions
  .region(location)
  .runWith(runtime)
  .https.onCall(async (_data: unknown, context) => {
    await userAuthenticated({
      context,
      demo: true,
    });

    await updateFiresotre(context.auth?.uid, 'disable');

    const url: string = functions.config().app.ses_hub.url;

    const userMail = {
      to: 'hirotomoyamada.pvt@gmail.com',
      from: `SES_HUB <${functions.config().admin.ses_hub}>`,
      subject: 'SES_HUB 案件/人材情報ご登録のススメ',
      text: body.remind.user(url),
    };

    await send(userMail);

    await log({
      auth: { collection: 'companys', doc: context.auth?.uid },
      run: 'disableRemind',
      code: 200,
    });

    return;
  });

const updateFiresotre = async (
  uid: string | undefined,
  remind: Firestore.Company['remind'],
): Promise<void> => {
  const timestamp = Date.now();

  if (!uid) return;

  const doc = await db
    .collection('companys')
    .doc(uid)
    .withConverter(converter<Firestore.Company>())
    .get()
    .catch(() => {
      throw new functions.https.HttpsError(
        'not-found',
        'ユーザーの取得に失敗しました',
        'firebase',
      );
    });

  if (!doc.exists) return;

  await doc.ref
    .set(
      {
        remind,
        updateAt: timestamp,
      },
      { merge: true },
    )
    .catch(() => {
      throw new functions.https.HttpsError(
        'data-loss',
        'プロフィールの更新に失敗しました',
        'firebase',
      );
    });

  return;
};
