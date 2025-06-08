import express from 'express';
import dotenv from 'dotenv';
import Conversation from '../models/Conversation.js';
import FAQ from '../models/FAQ.js';

// Load environment variables first
dotenv.config();

const router = express.Router();

// OpenRouter API configuration
const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

// Available free models on OpenRouter
const DEFAULT_MODEL = 'mistralai/mistral-7b-instruct:free';

// System prompt for customer support
const SYSTEM_PROMPT = `You are a helpful and professional customer support assistant. 
- Be friendly, empathetic, and solution-oriented
- Provide clear and concise answers
- If you don't know something, admit it and offer to connect the user with a human agent
- Always maintain a professional tone while being approachable
- Focus on resolving customer issues efficiently`;

// Send a message and get AI response
router.post('/', async (req, res) => {
  try {
    const { message, userId, sessionId } = req.body;

    if (!message || !userId || !sessionId) {
      return res.status(400).json({ error: 'Message, userId, and sessionId are required' });
    }

    if (!OPENROUTER_API_KEY) {
      return res.status(500).json({ error: 'OpenRouter API key not configured' });
    }

    // Get or create conversation
    let conversation = await Conversation.findOne({ userId, sessionId });
    
    if (!conversation) {
      conversation = new Conversation({
        userId,
        sessionId,
        messages: []
      });
    }

    // Add user message
    conversation.messages.push({
      role: 'user',
      content: message,
      timestamp: new Date()
    });

    // Check for FAQ matches first
    const faqMatch = await findRelevantFAQ(message);
    
    // Prepare messages for OpenRouter
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...(faqMatch ? [{ role: 'system', content: `Relevant FAQ: Q: ${faqMatch.question} A: ${faqMatch.answer}` }] : []),
      ...conversation.messages.slice(-10).map(msg => ({ // Keep last 10 messages for context
        role: msg.role,
        content: msg.content
      }))
    ];

    // Make request to OpenRouter API
    const openRouterResponse = await fetch(OPENROUTER_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.FRONTEND_URL || 'http://localhost:5173',
        'X-Title': 'AI Customer Support Chat'
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        messages: messages,
        max_tokens: 500,
        temperature: 0.7,
        stream: false
      })
    });

    if (!openRouterResponse.ok) {
      const errorData = await openRouterResponse.json().catch(() => ({}));
      console.error('OpenRouter API error:', errorData);
      throw new Error(`OpenRouter API error: ${openRouterResponse.status} ${openRouterResponse.statusText}`);
    }

    const completion = await openRouterResponse.json();
    
    if (!completion.choices || !completion.choices[0] || !completion.choices[0].message) {
      throw new Error('Invalid response format from OpenRouter API');
    }

    const aiResponse = completion.choices[0].message.content;

    // Add AI response to conversation
    conversation.messages.push({
      role: 'assistant',
      content: aiResponse,
      timestamp: new Date()
    });

    // Generate title for new conversations
    if (conversation.messages.length === 2) {
      conversation.title = message.length > 50 ? message.substring(0, 50) + '...' : message;
    }

    await conversation.save();

    res.json({
      response: aiResponse,
      conversationId: conversation._id,
      timestamp: new Date(),
      model: DEFAULT_MODEL
    });

  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ 
      error: 'Failed to process message',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Get chat history for a user
router.get('/history/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { limit = 50, page = 1 } = req.query;

    const conversations = await Conversation.find({ userId })
      .sort({ updatedAt: -1 })
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit))
      .select('sessionId title messages updatedAt createdAt');

    res.json(conversations);
  } catch (error) {
    console.error('History fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch chat history' });
  }
});

// Get specific conversation
router.get('/conversation/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { userId } = req.query;

    const conversation = await Conversation.findOne({ sessionId, userId });
    
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    res.json(conversation);
  } catch (error) {
    console.error('Conversation fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch conversation' });
  }
});

// Get available models endpoint
router.get('/models', async (req, res) => {
  try {
    if (!OPENROUTER_API_KEY) {
      return res.status(500).json({ error: 'OpenRouter API key not configured' });
    }

    const response = await fetch('https://openrouter.ai/api/v1/models', {
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch models: ${response.status}`);
    }

    const models = await response.json();
    
    // Filter for free models
    const freeModels = models.data.filter(model => 
      model.pricing && 
      (model.pricing.prompt === 0 || model.pricing.prompt === '0') &&
      (model.pricing.completion === 0 || model.pricing.completion === '0')
    );

    res.json({
      currentModel: DEFAULT_MODEL,
      availableModels: freeModels.map(model => ({
        id: model.id,
        name: model.name,
        description: model.description,
        context_length: model.context_length
      }))
    });

  } catch (error) {
    console.error('Models fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch available models' });
  }
});

// Helper function to find relevant FAQ
async function findRelevantFAQ(message) {
  try {
    const faqs = await FAQ.find({ isActive: true })
      .sort({ priority: -1 })
      .limit(10);

    // Simple keyword matching
    const messageLower = message.toLowerCase();
    
    for (const faq of faqs) {
      const questionLower = faq.question.toLowerCase();
      const keywords = faq.keywords.map(k => k.toLowerCase());
      
      // Check if message contains FAQ keywords or similar question words
      if (keywords.some(keyword => messageLower.includes(keyword)) ||
          messageLower.includes(questionLower) ||
          questionLower.includes(messageLower)) {
        return faq;
      }
    }
    
    return null;
  } catch (error) {
    console.error('FAQ search error:', error);
    return null;
  }
}

export default router;