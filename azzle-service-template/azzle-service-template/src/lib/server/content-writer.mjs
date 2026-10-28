
/**
 * Lana's Web3 Content Agent
 *
 * Generates a five-post Web3 content pack from an order brief.
 * Requires OPENAI_API_KEY to be configured securely on the server.
 */

export async function generateContent(brief) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured on the server.");
  }

  const source = brief?.source || {};
  const fields = brief?.fields || {};

  const projectInfo = [
    `Project: ${source.title || "Not provided"}`,
    `Description: ${source.tagline || "Not provided"}`,
    `Website or repository: ${source.sourceUrl || "Not provided"}`,
    `Source material: ${source.text || "Not provided"}`,
    `Audience: ${fields.audience || "Web3 community"}`,
    `Customer instructions: ${fields.notes || "None provided"}`,
  ].join("\n\n");

  const prompt = `
You are Lana's Web3 Content Agent.

Create a useful, natural-sounding content pack for an X account
promoting the project described below.

PROJECT BRIEF
${projectInfo}

REQUIREMENTS
- Write exactly five distinct X posts.
- Give each post a different angle or purpose.
- Write two alternative opening hooks.
- Include one clear call to action.
- Include brief revision instructions for the customer.
- Sound human, conversational, and knowledgeable about Web3.
- Avoid robotic wording, generic AI phrases, repetitive hooks,
  and forced hype.
- Do not invent partnerships, metrics, token details, or claims.
- If information is missing, do not pretend it is confirmed.
- Do not add emojis unless the customer requests them.
- Keep the posts suitable for X.

Use this format:

# Five-Post Web3 Content Pack

## Post 1
[Post text]

## Post 2
[Post text]

## Post 3
[Post text]

## Post 4
[Post text]

## Post 5
[Post text]

## Two Alternative Hooks
1. [Hook]
2. [Hook]

## Call to Action
[CTA]

## Revision
The customer may request one revision. Ask them to identify
the post and explain what they would like changed.
`;

  const response = await fetch(
    "https://api.openai.com/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        messages: [
          {
            role: "system",
            content:
              "You write accurate, natural Web3 content. Follow the brief and never invent facts.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        temperature: 0.8,
      }),
      signal: AbortSignal.timeout(60000),
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(
      `Content generation failed (${response.status}): ${error.slice(0, 500)}`
    );
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content?.trim();

  if (!content) {
    throw new Error("The AI returned an empty content pack.");
  }

  return content;
}
