import {Context, h, Schema, Session, Element} from 'koishi'

export const name = 'omg-mj-d'
export const inject = ['database']
export const usage = `## **使用**

1. 设置指令别名。
2. 注册 [OhMyGpt](https://www.ohmygpt.com/) (邀请码 \`xr26JIUD\`) 并配置。
3. 使用 \`omd.绘图\` 指令进行绘图，如：\`omd.绘图 a dog\`。
4. 后续操作：引用回复消息，并输入 \` 1 \` 、\` 2 \` 、\` 3 \` 、\` 4 \` ... (注意！所有数字前后都需有空格)。
5. 混合图片参数 (可选): \`-p\` (竖图 2:3), \`-s\` (方图 1:1), \`-l\` (横图 3:2, 默认)。
   - 例：\`omd.混合 -l [这里放 2一3 张图片或者 @ 多名群成员]\`。

## **特性**

* OneBot 适配器中，可通过 @ 成员获取头像用于提示词，也可直接使用图片。

## QQ 群

* 956758505`

// pz*
export interface Config {
  baseURL: string;
  apiKey: string;
  type: string;

  atReply: boolean;
  quoteReply: boolean;

  isLog: boolean;
}

export const Config: Schema<Config> =

  Schema.intersect([
    Schema.object({
      baseURL: Schema.string().default('https://c-z0-api-01.hash070.com/'),
      apiKey: Schema.string(),
      type: Schema.union(['FAST', 'NORMAL']).default('FAST'),
    }).description('API'),

    Schema.object({
      atReply: Schema
        .boolean()
        .default(false)
        .description('响应时 @'),
      quoteReply: Schema
        .boolean()
        .default(true)
        .description('响应时引用'),
    }).description('回复'),


    Schema.object({
      isLog: Schema
        .boolean()
        .default(false)
        .description('是否记录'),
    }).description('日志'),

  ])

// smb*
declare module 'koishi' {
  interface Tables {
    omg_mj: MJ;
  }
}

// jk*
interface MJ {
  id: number;
  msgId: string;
  data: TaskData;
}

interface SubmitSuccessResponse {
  success: true;
  data: number;
}

interface SubmitErrorResponse {
  success: false;
  statusCode: number;
  message: string;
}

interface QuerySuccessResponse {
  success: true;
  data: QueryApifoxResponse
}

interface QueryErrorResponse {
  success: false;
  statusCode: number;
  message: string
}

interface QueryApifoxResponse {
  data: TaskData;
  message: string;
  statusCode: number;

  [property: string]: any;
}

interface TaskData {
  action: string;
  actions: TaskAction[];
  description: string;
  failReason: null | string;
  finishTime: string;
  imageDcUrl: string;
  imageS3Url: null | string;
  progress: string;
  prompt: string;
  startTime: string;
  status: string;
  submitTime: string;
  taskId: number;
  taskType: string;
  webhookUrl: string;

  [property: string]: any;
}

interface TaskAction {
  customId: string;
  emoji: string;
  label: string;

  [property: string]: any;
}

// lx*
type MidjourneyResponse = SubmitSuccessResponse | SubmitErrorResponse;
type TaskQueryResult = QuerySuccessResponse | QueryErrorResponse;

export async function apply(ctx: Context, cfg: Config) {
  // tzb*
  ctx.model.extend('omg_mj', {
    id: 'unsigned',
    data: 'json',
    msgId: 'string',
  }, {autoInc: true, primary: 'id'});

  // cl*
  const logger = ctx.logger('omg-mj-d')
  const ini_mjs = await ctx.database.get('omg_mj', {});

  // bl*
  let msgIds = ini_mjs.map((mj) => mj.msgId);

  // zjj*
  ctx.middleware(async (session, next) => {
    if (!session.quote) {
      return await next();
    }
    const quoteId = session.quote.id
    if (!msgIds.includes(session.quote.id)) {
      return await next();
    }

    const mjs = await ctx.database.get('omg_mj', {msgId: quoteId});
    if (mjs.length === 0) {
      return await next();
    }
    const mj = mjs[0];
    const data = mj.data;
    const {actions, taskId} = data;
    const content = `${h.select(session.elements, 'text')}`

    let isExecuted = false;

    for (const [index, element] of actions.entries()) {
      if (content.includes(` ${index + 1} `)) {
        const result = await submitAction(taskId.toString(), element.customId);
        if (cfg.isLog) {
          logger.info(result);
        }
        if (!result.success) {
          continue;
        }
        const queryResult = await executeMidjourneyTask((result as SubmitSuccessResponse).data.toString());
        if (!queryResult.success) {
          continue;
        }
        const data = queryResult.data.data;
        const {imageDcUrl, actions} = data;
        const msgId = await sendMsg(session, `${h.image(imageDcUrl)}\n${formatTaskActions(actions)}`, true);
        await ctx.database.create('omg_mj', {
          msgId: msgId,
          data: data,
        });
        msgIds.push(msgId);
        isExecuted = true;
      }
    }

    if (!isExecuted) {
      return await next();
    }

  }, true);

  // zl*
  ctx
    .command('omd', 'midjourney')

  // ht*
  ctx
    .command('omd.绘图 <prompt:text>', {captureQuote: false})
    .action(async ({session}, prompt) => {
      let headImgUrls = [];
      if (session.platform === 'onebot' || session.platform === 'red') {
        headImgUrls = getHeadImgUrls(h.select(prompt, 'at'))
      }
      prompt = `${h.select(prompt, 'text')}`

      if (!prompt && session.quote) {
        prompt = `${h.select(session.quote.elements, 'text')}`
      }
      if (!prompt) {
        return sendMsg(session, `缺少提示词

指令：omd.绘图 提示词

示例：omd.绘图 a dog`);
      }

      const quoteImgUrls = extractImageSources(session.quote?.elements || []);
      const promptImgUrls = extractImageSources(session.elements);
      const retrieveIds = await uploadImagesAndRetrieveIds([...headImgUrls, ...quoteImgUrls, ...promptImgUrls]);
      const uploadedImgUrls = retrieveIds.map((id) => `https://pi.ohmygpt.com/api/v1/f/pub/${id}`);

      prompt = `${uploadedImgUrls.join(' ')} ${prompt}`;
      const result = await submitImagine(prompt);
      if (cfg.isLog) {
        logger.info(result);
        logger.info(`Prompt: ${prompt}`);
      }

      if (!result.success) {
        return sendMsg(session, `绘图失败: ${(result as SubmitErrorResponse).message}`);
      }
      const taskId = (result as SubmitSuccessResponse).data.toString();
      const queryResult = await executeMidjourneyTask(taskId);
      if (!queryResult.success) {
        return sendMsg(session, `绘图失败: ${(queryResult as QueryErrorResponse).message}`);
      }
      const data = (queryResult as QuerySuccessResponse).data.data;
      const {imageDcUrl, actions} = data;

      const msgId = await sendMsg(session, `${h.image(imageDcUrl)}\n${formatTaskActions(actions)}`, true);

      await ctx.database.create('omg_mj', {
        msgId: msgId,
        data: data,
      })

      msgIds.push(msgId);
    });

  // hh*
  ctx
    .command('omd.混合 <prompt:text>', '2一5 张图',{captureQuote: false})
    .option('portrait', '-p')
    .option('square', '-s')
    .option('landscape', '-l')
    .action(async ({session, options}, prompt) => {
      let headImgUrls = [];
      if (session.platform === 'onebot' || session.platform === 'red') {
        headImgUrls = getHeadImgUrls(h.select(prompt, 'at'))
      }
      prompt = `${h.select(prompt, 'text')}`

      if (!prompt && session.quote) {
        prompt = `${h.select(session.quote.elements, 'text')}`
      }

      const promptLinks = extractLinksInPrompts(prompt);
      const quoteImgUrls = extractImageSources(session.quote?.elements || []);
      const promptImgUrls = extractImageSources(session.elements);
      const allImgUrls = [...promptLinks, ...headImgUrls, ...promptImgUrls, ...quoteImgUrls];

      if (allImgUrls.length < 2 || allImgUrls.length > 5) {
        return sendMsg(session, `需要 2一5 张图片`);
      }

      const base64Array = await convertImageUrlsToBase64(allImgUrls);

      let dimensions = 'LANDSCAPE';
      if (options.portrait) {
        dimensions = 'PORTRAIT';
      } else if (options.square) {
        dimensions = 'SQUARE';
      }

      const result = await submitBlend(base64Array, dimensions);
      if (cfg.isLog) {
        logger.info(result);
        logger.info(`Blend: ${allImgUrls.join(' ')}`);
      }

      if (!result.success) {
        return sendMsg(session, `绘图失败: ${(result as SubmitErrorResponse).message}`);
      }
      const taskId = (result as SubmitSuccessResponse).data.toString();
      const queryResult = await executeMidjourneyTask(taskId);
      if (!queryResult.success) {
        return sendMsg(session, `绘图失败: ${(queryResult as QueryErrorResponse).message}`);
      }
      const data = (queryResult as QuerySuccessResponse).data.data;
      const {imageDcUrl, actions} = data;

      const msgId = await sendMsg(session, `${h.image(imageDcUrl)}\n${formatTaskActions(actions)}`, true);

      await ctx.database.create('omg_mj', {
        msgId: msgId,
        data: data,
      })

      msgIds.push(msgId);
    });

  // scsyjl*
  ctx
    .command('omd.删除所有记录', {authority: 2})
    .action(async ({session}, prompt) => {
      await ctx.database.remove('omg_mj', {});
      msgIds = [];
      await sendMsg(session, `已删除所有记录`);
    });

  // hs*
  async function convertImageUrlToBase64(imgUrl: string): Promise<string> {
    try {
      const response = await fetch(imgUrl);
      if (!response.ok) {
        logger.error(`Failed to fetch image: ${response.status} ${response.statusText}`);
        return '';
      }

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const base64String = buffer.toString('base64');

      return `data:image/webp;base64,${base64String}`;

    } catch (error) {
      logger.error(`Error processing image ${imgUrl}:`, error);
      return '';
    }
  }

  async function convertImageUrlsToBase64(allImgUrls: string[]): Promise<string[]> {
    const promises = allImgUrls.map(convertImageUrlToBase64);
    const results = await Promise.all(promises);
    return results.filter(result => result !== '');
  }

  function extractLinksInPrompts(prompt: string): string[] {
    const urlRegex = /(https?:\/\/[^\s]+)/g;

    return prompt.match(urlRegex) || [];
  }

  function getHeadImgUrls(atElements: Element[]): string[] {
    return atElements.map(element => {
      const atId = element.attrs.id;
      return `https://q.qlogo.cn/headimg_dl?dst_uin=${atId}&spec=640`;
    });
  }

  async function uploadImagesAndRetrieveIds(imgUrls: string[]): Promise<string[]> {
    const fileUniqueIDs: string[] = [];

    for (const imgUrl of imgUrls) {
      const imageResponse = await fetch(imgUrl);
      if (!imageResponse.ok) {
        logger.error(`Failed to fetch image from ${imgUrl}: ${imageResponse.status} ${imageResponse.statusText}`);
        return [];
      }
      const imageBlob = await imageResponse.blob();

      const url = new URL(imgUrl);
      const pathname = url.pathname;
      const filename = pathname.substring(pathname.lastIndexOf('/') + 1);

      const formData = new FormData();
      formData.append("file", imageBlob, filename);
      formData.append("filename", filename);
      formData.append("purpose", "3");
      formData.append("is_public", "true");

      const now = new Date();
      const expiresAt = new Date(now.getTime() + 60 * 1000);
      const expiresAtISOString = expiresAt.toISOString();
      formData.append("expires_at", expiresAtISOString);

      const uploadResponse = await fetch(`${cfg.baseURL}/api/v1/user/files/upload`, {
        method: 'POST',
        body: formData,
        headers: {
          Authorization: `Bearer ${cfg.apiKey}`,
        },
        redirect: 'follow'
      });

      if (!uploadResponse.ok) {
        const errorText = await uploadResponse.text();
        logger.error(`File upload failed for ${filename}: ${uploadResponse.status} ${uploadResponse.statusText} - ${errorText}`);
        return [];
      }

      const responseData = await uploadResponse.json();

      if (responseData && responseData.data && responseData.data.fileUniqueID) {
        fileUniqueIDs.push(responseData.data.fileUniqueID);
      } else {
        logger.error(`Invalid response from file upload API for ${filename}: ${JSON.stringify(responseData)}`);
        return [];
      }
    }

    return fileUniqueIDs;
  }

  function extractImageSources(elements: Element[]): string[] {
    return elements.flatMap(element => {
      const sources: string[] = [];
      if (element.attrs && element.attrs.src) {
        sources.push(element.attrs.src);
      }
      if (element.children && element.children.length > 0) {
        sources.push(...extractImageSources(element.children));
      }
      return sources;
    });
  }

  function formatTaskActions(actions: TaskAction[]): string {
    const formattedLines = actions.map((action, index) => {
      const serialNumber = index + 1;
      return `${serialNumber} ${action.emoji}${action.label}`;
    });

    return formattedLines.join('\n');
  }

  async function executeMidjourneyTask(taskId: string): Promise<TaskQueryResult> {
    return new Promise((resolve) => {
      const intervalId = setInterval(async () => {
        const queryResult = await getMidjourneyTask(taskId);
        if (cfg.isLog) {
          logger.info(queryResult);
        }

        if (!queryResult.success) {
          clearInterval(intervalId);
          resolve(queryResult);
          return;
        }

        const failReason = queryResult.data.data.failReason
        if (failReason) {
          clearInterval(intervalId);
          resolve({
            success: false,
            statusCode: queryResult.data.statusCode,
            message: queryResult.data.data.failReason
          });
          return;
        }

        if (queryResult.data.data.status === "SUCCESS") {
          clearInterval(intervalId);
          resolve(queryResult);
          return;
        }

        if (queryResult.data.data.status === "FAILURE") {
          clearInterval(intervalId);
          resolve({
            success: false,
            statusCode: queryResult.data.statusCode,
            message: queryResult.data.data.failReason || "Midjourney task failed."
          });
          return;
        }

      }, 5000);
    });
  }

  async function getMidjourneyTask(taskId: string): Promise<TaskQueryResult> {
    const data = JSON.stringify({
      "model": "midjourney",
      "taskId": taskId
    });

    const fetchOptions: RequestInit = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: data,
      redirect: "follow",
    };

    try {
      const API_URL = `${removeTrailingSlash(cfg.baseURL)}/api/v1/ai/draw/mj/query`;
      const response = await fetch(API_URL, fetchOptions);

      if (response.ok) {
        const taskData: QueryApifoxResponse = await response.json();
        return {success: true, data: taskData};
      } else {
        return {
          success: false,
          statusCode: response.status,
          message: `Request failed with status: ${response.status}`,
        };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        statusCode: 0,
        message: `Network error: ${message}`,
      };
    }
  }

  async function submitAction(taskId: string, customId: string): Promise<MidjourneyResponse> {
    const data = JSON.stringify({
      "model": "midjourney",
      "taskId": taskId,
      "type": cfg.type,
      "customId": customId,
    });

    const requestOptions: RequestInit = {
      method: 'POST',
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: data,
      redirect: 'follow'
    };

    try {
      const response = await fetch(`${removeTrailingSlash(cfg.baseURL)}/api/v1/ai/draw/mj/action`, requestOptions);

      if (response.ok) {
        try {
          const parsedResult = await response.json();
          if (parsedResult.data) {
            return {success: true, data: parsedResult.data};
          } else {
            return {
              success: false,
              statusCode: parsedResult.statusCode,
              message: parsedResult.message || 'Missing data field'
            };
          }
        } catch (jsonError) {
          return {success: false, statusCode: response.status, message: `JSON parsing error: ${jsonError.message}`};
        }
      } else {
        return {success: false, statusCode: response.status, message: response.statusText || 'Unknown error'};
      }
    } catch (error: any) {
      return {success: false, statusCode: 0, message: error.message || 'Network error'};
    }
  }

  async function submitBlend(base64Array: string[], dimensions: string): Promise<MidjourneyResponse> {
    const data = JSON.stringify({
      "model": "midjourney",
      "base64Array": base64Array,
      "type": cfg.type,
      "dimensions": dimensions,
    });

    const requestOptions: RequestInit = {
      method: 'POST',
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: data,
      redirect: 'follow'
    };

    try {
      const response = await fetch(`${removeTrailingSlash(cfg.baseURL)}/api/v1/ai/draw/mj/blend`, requestOptions);

      if (response.ok) {
        try {
          const parsedResult = await response.json();
          if (parsedResult.data) {
            return {success: true, data: parsedResult.data};
          } else {
            return {
              success: false,
              statusCode: parsedResult.statusCode,
              message: parsedResult.message || 'Missing data field'
            };
          }
        } catch (jsonError) {
          return {success: false, statusCode: response.status, message: `JSON parsing error: ${jsonError.message}`};
        }
      } else {
        return {success: false, statusCode: response.status, message: response.statusText || 'Unknown error'};
      }
    } catch (error: any) {
      return {success: false, statusCode: 0, message: error.message || 'Network error'};
    }
  }

  async function submitImagine(prompt: string): Promise<MidjourneyResponse> {
    const data = JSON.stringify({
      "model": "midjourney",
      "prompt": prompt,
      "type": cfg.type,
    });

    const requestOptions: RequestInit = {
      method: 'POST',
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: data,
      redirect: 'follow'
    };

    try {
      const response = await fetch(`${removeTrailingSlash(cfg.baseURL)}/api/v1/ai/draw/mj/imagine`, requestOptions);

      if (response.ok) {
        try {
          const parsedResult = await response.json();
          if (parsedResult.data) {
            return {success: true, data: parsedResult.data};
          } else {
            return {
              success: false,
              statusCode: parsedResult.statusCode,
              message: parsedResult.message || 'Missing data field'
            };
          }
        } catch (jsonError) {
          return {success: false, statusCode: response.status, message: `JSON parsing error: ${jsonError.message}`};
        }
      } else {
        return {success: false, statusCode: response.status, message: response.statusText || 'Unknown error'};
      }
    } catch (error: any) {
      return {success: false, statusCode: 0, message: error.message || 'Network error'};
    }
  }

  function removeTrailingSlash(baseURL: string): string {
    baseURL = baseURL.trim()

    if (baseURL.endsWith('/')) {
      return baseURL.slice(0, -1);
    } else {
      return baseURL;
    }
  }

  async function sendMsg(session: Session, msg: any, isReturnMsgId = false) {
    if (cfg.atReply) {
      msg = `${h.at(session.userId)}${h('p', '')}${msg}`;
    }

    if (cfg.quoteReply) {
      msg = `${h.quote(session.messageId)}${msg}`;
    }

    const [msgId] = await session.send(msg);
    if (isReturnMsgId) {
      return msgId;
    }
  }
}
