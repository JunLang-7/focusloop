import {
  DEFAULT_COURSE_COPY,
  type CourseCopy,
  type DemoCopy,
  type TaskCopy,
} from '@focusloop/agent-core';
import type { Locale } from '@focusloop/shared-types';

/**
 * The app's own course wording, in the learner's language (#2).
 *
 * The interface already had one bilingual implementation — keys in `src/app/core/i18n/`, never a
 * sentence in the domain. The built-in course and the generated one were the two places that broke
 * it: `Read: 模拟调制` inside a Chinese window, and a whole English course behind the Chinese Home
 * page. The sentences are the app's, so they are translated here, in the shell, next to the locale
 * the app already stores.
 *
 * English is not repeated here. `DEFAULT_COURSE_COPY` in `agent-core` is the English wording, and it
 * is what a locale with no bundle of its own gets — one place to change, not two that can drift.
 */
const ZH_TASK_COPY: TaskCopy = {
  readTitle: (heading) => `阅读：${heading}`,
  readInstructions: (sentence) => `读这一节，然后用一句话概括它：${sentence}`,
  practiseTitle: (heading) => `练习：${heading}`,
  practiseInstructions: (heading) => `用你自己想出来的一个具体例子解释「${heading}」。`,
  quizQuestion: (conceptTitle) => `下面哪一句属于「${conceptTitle}」？`,
  courseDescription: (title, format) => `由「${title}」生成（${format}）。`,
  emptyWarning: '没有找到可以阅读的章节，因此没有生成微任务。',
  truncationWarning: (maxConcepts) => `只用了前 ${maxConcepts} 个章节，其余内容仍留在原文里。`,
};

const ZH_DEMO_COPY: DemoCopy = {
  title: '红黑树：入门',
  description: '五步走完平衡树：不变式、旋转与插入修复。',
  concepts: [
    {
      title: '二叉搜索树回顾',
      summary: '二叉搜索树让每个左后代更小、每个右后代更大。',
      keyPoints: ['中序遍历就是有序的', '查找代价取决于树高'],
    },
    {
      title: '红黑树的不变式',
      summary: '五条关于颜色与黑高的规则让红黑树保持平衡。',
      keyPoints: ['根节点是黑色的', '红节点不能有红孩子', '每条路径的黑高相等'],
    },
    {
      title: '旋转',
      summary: '一次旋转调整三个节点的结构，同时保持中序次序。',
      keyPoints: ['左旋把支点向右下移动', '旋转的代价是 O(1)'],
    },
    {
      title: '插入修复',
      summary: '插入一个红色节点后，向上重新着色并旋转，直到树重新合法。',
      keyPoints: ['叔叔是红色时重新着色', '叔叔是黑色时旋转'],
    },
  ],
  tasks: [
    {
      title: '写出顺序不变式',
      instructions: '合上笔记，用一句话写出二叉搜索树的顺序不变式。',
    },
    {
      title: '说出红黑树的五条性质',
      instructions: '凭记忆列出这五条性质，并标出你最想不起来的那一条。',
    },
    {
      title: '手推一次左旋',
      instructions: '画一棵三节点的树，把它左旋，并检查中序序列没有改变。',
    },
    {
      title: '检查颜色不变式',
      instructions: '判断给出的这棵树是否满足「红节点不能有红孩子」。',
    },
    {
      title: '完成一次插入修复',
      instructions: '把 7 插入一棵小的红黑树，用重新着色和旋转让它重新合法。',
    },
  ],
  quizzes: [
    {
      question: '红节点可以有红孩子吗？',
      options: ['树小的时候可以', '任何情况下都不可以', '只有根节点可以'],
      explanation: '「红节点不能有红孩子」是五条不变式之一，没有例外。',
    },
    {
      question: '一次旋转保持了什么不变？',
      options: ['中序序列', '树的高度', '每个节点的颜色'],
      explanation: '旋转只改变结构，排好序的中序序列完全不变。',
    },
  ],
  interruption: '学习者切换到另一个标签页，30 秒后回来。',
};

/** The wording in force for a locale, falling back to the English default. */
export function courseCopyFor(locale: Locale): CourseCopy {
  return locale === 'zh' ? { task: ZH_TASK_COPY, demo: ZH_DEMO_COPY } : DEFAULT_COURSE_COPY;
}
