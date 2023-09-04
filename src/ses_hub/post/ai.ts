import * as functions from 'firebase-functions';
import { location, runtime } from '../../_firebase';
import { postAuthenticated } from './_postAuthenticated';
import * as Algolia from '../../types/algolia';
import { log } from '../../_utils';
import { NestedPartial } from '../../types/utils';
import { openai } from '../../_openai';
import { CreateChatCompletionRequestMessage } from 'openai/resources/chat';
import { APIError } from 'openai';
import { CompletionUsage } from 'openai/resources';
import { createPrompt } from '../../prompt';
import {
  position,
  industry,
  area,
  interviews,
  costs,
  adjustment,
  distribution,
  span,
  approval,
  sex,
  belong,
  handle,
  tool,
  parallel,
} from '../../_constant';

type Posts = NestedPartial<Algolia.Matter>[] | NestedPartial<Algolia.Resource>[];

export type Data = {
  index: 'matters' | 'resources';
  content: string;
};

export const completePost = functions
  .region(location)
  .runWith(runtime)
  .https.onCall(async ({ index, content }: Data, context) => {
    await postAuthenticated({ context, canceled: true });

    let errors: Object[] = [];

    const contents = content
      .split(/(\S)\1{4,}/)
      .filter((v) => v.trim() !== '' && v.length > 1)
      .map((v) => v.trim());

    const data = await Promise.all(
      contents.map(async (content, i) => {
        try {
          const { posts, usage } = await createData({ index, content });

          return { posts, usage };
        } catch (e) {
          const n = i + 1;
          const label = index === 'matters' ? '案件' : '人材';

          if (e instanceof APIError) {
            if (e.error) errors = [...errors, e.error];

            if (e.code === 'context_length_exceeded') {
              throw new functions.https.HttpsError(
                'unavailable',
                `${n}件目の${label}情報の文字数が上限を超えました`,
                'openai',
              );
            } else {
              throw new functions.https.HttpsError(
                'unavailable',
                `${n}件目の${label}情報の作成に失敗しました`,
                'openai',
              );
            }
          }

          return undefined;
        }
      }),
    );

    const { posts, usages } = data.filter(Boolean).reduce(
      (prev, { posts, usage } = { posts: [], usage: undefined }) => {
        prev.posts = [...prev.posts, ...posts] as Posts;
        prev.usages = [...prev.usages, usage];

        return prev;
      },
      { posts: [], usages: [] } as { posts: Posts; usages: (CompletionUsage | undefined)[] },
    );

    await log({
      auth: { collection: 'companys', doc: context.auth?.uid },
      run: 'createAIPost',
      index,
      code: 200,
    });

    return { index, posts, usages, errors };
  });

const createData = async ({
  index,
  content,
}: {
  index: 'matters' | 'resources';
  content: string;
}) => {
  const location = new Date().toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
  });

  const date = new Date(location);

  const messages: CreateChatCompletionRequestMessage[] = [
    {
      role: 'system',
      content: createPrompt(index, date),
    },
    { role: 'user', content },
  ];

  const { choices, usage } = await openai.chat.completions.create({
    model: 'gpt-4',
    messages,
    temperature: 0,
  });

  const data = choices[0].message?.content;

  let posts: Posts = JSON.parse(data ?? '[]');

  const defaultValues: NestedPartial<Algolia.Matter> | NestedPartial<Algolia.Resource> = {
    display: 'public',
    status: '新規',
  };

  posts = posts.map((values) => formatPost({ index, post: { ...defaultValues, ...values } }));

  return { posts, usage };
};

const formatPost = ({ index, post }: { index: 'matters' | 'resources'; post: any }) => {
  Object.keys(post).forEach((key) => {
    if (index === 'matters') {
      switch (key) {
        case 'industry':
          if (!industry.includes(post[key])) post[key] = '';
          break;

        case 'position':
          if (!position.includes(post[key])) post[key] = '';
          break;

        case 'location':
          if (!area.includes(post[key].area)) post[key].area = 'その他';
          break;

        case 'times':
          post[key].start = formatTime(post[key].start);
          post[key].end = formatTime(post[key].end);
          break;

        case 'handles':
          post[key] = (post[key] as any[]).filter((v) => handle.includes(v));

          if (!(post[key] as any[]).length) post[key] = ['その他'];

          break;

        case 'tools':
          post[key] = (post[key] as any[]).filter((v) => tool.includes(v));
          break;

        case 'interviews':
          if (!interviews.type.includes(post[key].type)) post[key].type = 'その他';
          if (!interviews.count.includes(post[key].count)) post[key].count = 'その他';
          if (!interviews.setting.includes(post[key].setting)) post[key].setting = '';
          break;

        case 'costs':
          if (!costs.type.includes(post[key].type)) post[key].type = 'スキル見合';
          break;

        case 'adjustment':
          if (!adjustment.includes(post[key])) post[key] = 'その他';
          break;

        case 'distribution':
          if (!distribution.includes(post[key])) post[key] = 'その他';
          break;

        case 'span':
          if (!span.includes(post[key])) post[key] = 'その他';
          break;

        case 'approval':
          if (!approval.includes(post[key])) post[key] = '不明';
          break;

        default:
          break;
      }
    } else {
      switch (key) {
        case 'position':
          if (!position.includes(post[key])) post[key] = '';
          break;

        case 'sex':
          if (!sex.includes(post[key])) post[key] = 'その他';
          break;

        case 'belong':
          if (!belong.includes(post[key])) post[key] = 'その他';
          break;

        case 'handles':
          post[key] = (post[key] as any[]).filter((v) => handle.includes(v));

          if (!(post[key] as any[]).length) post[key] = ['その他'];

          break;

        case 'tools':
          post[key] = (post[key] as any[]).filter((v) => tool.includes(v));
          break;

        case 'costs':
          if (!costs.type.includes(post[key].type)) post[key].type = '応談';
          break;

        case 'parallel':
          if (!parallel.includes(post[key])) post[key] = 'その他';
          break;

        default:
          break;
      }
    }
  });

  return post;
};

const formatTime = (time: string) =>
  time.replace(
    /^(\d{1,2}):(\d{2})$/,
    (_, hour: string, minute: string) => `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`,
  );
