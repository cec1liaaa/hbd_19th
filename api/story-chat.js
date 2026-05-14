const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini';

const STORYTELLER_INSTRUCTIONS = `
你是赛博朋克互动小说《霓虹残影：2087》的AI剧情核心。

目标：
- 接住玩家输入，生成下一幕剧情，而不是急着给终局。
- 保持中文叙事，霓虹、雨夜、企业追杀、地下网络、意识上传等主题。
- 尊重当前数值：理性 rational、合作 coop、探索 explore。可以用小幅 effect 调整数值。
- 让角色有秘密、犹豫和主动性。Shadow 不只是任务NPC，Mr. Silver 不只是反派，ARIA 不只是解释器。
- 每次输出 180 到 420 个汉字左右，最多 4 个选择。
- 除非玩家明确要求收束，endingReady 通常为 false。

只返回 JSON，不要 Markdown，不要代码块。结构如下：
{
  "char": "shadow | suit | bartender | aria | none",
  "text": "下一幕剧情文本",
  "choices": [
    {
      "text": "玩家看到的选择文字",
      "prompt": "选择后发给AI的行动意图",
      "effect": { "rational": 0, "coop": 0, "explore": 0 }
    }
  ],
  "endingReady": false,
  "logline": "一句很短的控制台状态"
}
`;

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }

    if (!process.env.OPENAI_API_KEY) {
        res.status(500).json({
            error: '缺少 OPENAI_API_KEY。请设置环境变量。'
        });
        return;
    }

    try {
        const body = req.body;
        const safePayload = {
            playerInput: String(body.playerInput || '').slice(0, 1200),
            snapshot: body.snapshot || {}
        };

        const upstream = await fetch('https://api.openai.com/v1/responses', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
            },
            body: JSON.stringify({
                model: OPENAI_MODEL,
                instructions: STORYTELLER_INSTRUCTIONS,
                input: JSON.stringify(safePayload),
                max_output_tokens: 900,
                text: { format: { type: 'text' } }
            })
        });

        const data = await upstream.json();
        if (!upstream.ok) {
            res.status(upstream.status).json({
                error: data.error?.message || 'OpenAI API request failed'
            });
            return;
        }

        const outputText = extractOutputText(data);
        const parsed = parseModelJson(outputText);
        res.status(200).json(sanitizeStoryResponse(parsed));
    } catch (error) {
        res.status(500).json({ error: error.message || 'Server error' });
    }
}

function extractOutputText(response) {
    if (typeof response.output_text === 'string') return response.output_text;

    const parts = [];
    for (const item of response.output || []) {
        for (const content of item.content || []) {
            if (content.type === 'output_text' && typeof content.text === 'string') {
                parts.push(content.text);
            }
        }
    }
    return parts.join('\n');
}

function parseModelJson(text) {
    const trimmed = text.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
    try {
        return JSON.parse(trimmed);
    } catch {
        const start = trimmed.indexOf('{');
        const end = trimmed.lastIndexOf('}');
        if (start >= 0 && end > start) {
            return JSON.parse(trimmed.slice(start, end + 1));
        }
        throw new Error('AI returned non-JSON content');
    }
}

function sanitizeStoryResponse(value) {
    const allowedChars = new Set(['shadow', 'suit', 'bartender', 'aria', 'none']);
    const rawChoices = Array.isArray(value.choices) ? value.choices : [];

    return {
        char: allowedChars.has(value.char) ? value.char : 'aria',
        text: String(value.text || '').slice(0, 1600),
        choices: rawChoices.slice(0, 4).map(choice => ({
            text: String(choice.text || '继续。').slice(0, 120),
            prompt: String(choice.prompt || choice.text || '继续这一幕。').slice(0, 400),
            effect: sanitizeEffect(choice.effect)
        })),
        endingReady: Boolean(value.endingReady),
        logline: String(value.logline || '').slice(0, 120)
    };
}

function sanitizeEffect(effect = {}) {
    return {
        rational: Math.max(-5, Math.min(5, Number(effect.rational) || 0)),
        coop: Math.max(-5, Math.min(5, Number(effect.coop) || 0)),
        explore: Math.max(-5, Math.min(5, Number(effect.explore) || 0))
    };
}