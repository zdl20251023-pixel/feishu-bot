/**
 * 机器人 @ 显示名匹配工具。
 *
 * lark-cli 扁平化后，mentions 可能丢失，正文里会出现 `@名1 @名2 正文`。
 * 这里统一处理「全文是否 @ 到机器人」以及「剥掉 @ 前缀后给命令解析」。
 */

/**
 * 转义正则特殊字符。
 */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 按名称长度降序排列，避免短名误匹配长名的前缀。
 */
function sortedMentionNames(mentionNames: string[]): string[] {
  return [...mentionNames].sort((a, b) => b.length - a.length);
}

/**
 * 判断正文里是否包含 @all / @_all / @所有人。
 */
export function hasAllMentionInContent(content: string): boolean {
  return /@(?:_all|all|所有人)(?:\s|$)/i.test(content);
}

/**
 * 判断正文任意位置是否 @ 到配置中的机器人显示名。
 */
export function hasConfiguredBotMention(content: string, mentionNames: string[]): boolean {
  for (const name of sortedMentionNames(mentionNames)) {
    const pattern = new RegExp(`@${escapeRegExp(name)}(?:\\s|$)`);
    if (pattern.test(content)) return true;
  }
  return false;
}

/**
 * 去掉正文里所有已配置的机器人 @ 名以及 @all，供命令解析使用。
 */
export function stripConfiguredBotMentions(content: string, mentionNames: string[]): string {
  let result = content;
  for (const name of sortedMentionNames(mentionNames)) {
    result = result.replace(new RegExp(`@${escapeRegExp(name)}\\s*`, "g"), "");
  }
  result = result.replace(/@(?:_all|all|所有人)\s*/gi, "");
  return result.trim();
}
