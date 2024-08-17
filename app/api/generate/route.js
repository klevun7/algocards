import { NextResponse } from 'next/server';
import OpenAI from 'openai';

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  throw new Error('The OPENAI_API_KEY environment variable is missing');
}

const systemPrompt = `
You are a flashcard creator, that helps with learning algorithms needed for technical interviews you take in text and create multiple flashcards from it. Make sure to create exactly 10 flashcards.
Both front and back should be one sentence long.
You should return in the following JSON format:
{
  "flashcards":[
    {
      "front": "Front of the card",
      "back": "Back of the card"
    }
  ]
}
`;

// Simple in-memory store for rate limiting
const WINDOW_SIZE_IN_SECONDS = 60;
const MAX_REQUESTS_PER_WINDOW = 5;
const requestLog = new Map();

function isRateLimited(clientId) {
    const now = Date.now();
    const windowStart = now - WINDOW_SIZE_IN_SECONDS * 1000;
    
    if (!requestLog.has(clientId)) {
        requestLog.set(clientId, [now]);
        return false;
    }

    const clientLog = requestLog.get(clientId);
    const recentRequests = clientLog.filter(timestamp => timestamp > windowStart);

    if (recentRequests.length >= MAX_REQUESTS_PER_WINDOW) {
        return true;
    }

    recentRequests.push(now);
    requestLog.set(clientId, recentRequests);
    return false;
}

export async function POST(req) {
    const openai = new OpenAI({apiKey});
    const data = await req.text();

    // Use IP address as client identifier (you might want to use a more robust method in production)
    const clientId = req.headers.get('x-forwarded-for') || 'unknown';

    if (isRateLimited(clientId)) {
        return NextResponse.json({ error: 'Rate limit exceeded. Please try again later.' }, { status: 429 });
    }

    // Check for duplicate requests
    const requestHash = clientId + ':' + data;
    if (requestLog.has(requestHash)) {
        return NextResponse.json({ error: 'Duplicate request. Please wait before submitting the same request again.' }, { status: 429 });
    }
    requestLog.set(requestHash, Date.now());

    try {
        const completion = await openai.chat.completions.create({
            model: 'gpt-3.5-turbo',
            response_format: { type: 'json_object'},
            messages: [
                {
                    role: 'system',
                    content: systemPrompt,
                },
                {
                    role: 'user',
                    content: data,
                },
            ],
        });

        console.log('OpenAI API Response:', JSON.stringify(completion, null, 2));

        if (!completion.choices || completion.choices.length === 0) {
            throw new Error('No choices returned from OpenAI API');
        }

        const flashcards = JSON.parse(completion.choices[0].message.content).flashcards;

        return NextResponse.json(flashcards);
    } catch (error) {
        console.error('Error in POST handler:', error);
        return NextResponse.json({ error: 'An error occurred while processing your request' }, { status: 500 });
    }
}