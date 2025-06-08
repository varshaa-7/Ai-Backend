import express from 'express';
import multer from 'multer';
import pdfParse from 'pdf-parse';
import FAQ from '../models/FAQ.js';

const router = express.Router();

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf' || file.mimetype === 'text/plain') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF and text files are allowed'), false);
    }
  }
});

// Upload and process FAQ documents
router.post('/upload-faqs', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    let text = '';
    
    if (req.file.mimetype === 'application/pdf') {
      const pdfData = await pdfParse(req.file.buffer);
      text = pdfData.text;
    } else {
      text = req.file.buffer.toString('utf-8');
    }

    // Simple FAQ parsing - assumes Q: and A: format
    const faqPairs = parseFAQText(text);
    
    const savedFAQs = [];
    for (const faq of faqPairs) {
      const newFAQ = new FAQ({
        question: faq.question,
        answer: faq.answer,
        category: req.body.category || 'Uploaded',
        keywords: extractKeywords(faq.question + ' ' + faq.answer)
      });
      
      await newFAQ.save();
      savedFAQs.push(newFAQ);
    }

    res.json({
      message: `Successfully processed ${savedFAQs.length} FAQs`,
      faqs: savedFAQs.length
    });

  } catch (error) {
    console.error('FAQ upload error:', error);
    res.status(500).json({ error: 'Failed to process FAQ file' });
  }
});

// Get all FAQs
router.get('/faqs', async (req, res) => {
  try {
    const { page = 1, limit = 20, category, search } = req.query;
    
    let query = {};
    
    if (category) {
      query.category = category;
    }
    
    if (search) {
      query.$text = { $search: search };
    }

    const faqs = await FAQ.find(query)
      .sort({ priority: -1, createdAt: -1 })
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit));

    const total = await FAQ.countDocuments(query);

    res.json({
      faqs,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });

  } catch (error) {
    console.error('FAQ fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch FAQs' });
  }
});

// Add single FAQ
router.post('/faqs', async (req, res) => {
  try {
    const { question, answer, category, keywords, priority } = req.body;

    if (!question || !answer) {
      return res.status(400).json({ error: 'Question and answer are required' });
    }

    const faq = new FAQ({
      question,
      answer,
      category: category || 'General',
      keywords: keywords || extractKeywords(question + ' ' + answer),
      priority: priority || 1
    });

    await faq.save();

    res.status(201).json({
      message: 'FAQ created successfully',
      faq
    });

  } catch (error) {
    console.error('FAQ creation error:', error);
    res.status(500).json({ error: 'Failed to create FAQ' });
  }
});

// Update FAQ
router.put('/faqs/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { question, answer, category, priority, isActive } = req.body;

    const faq = await FAQ.findByIdAndUpdate(
      id,
      {
        question,
        answer,
        category,
        priority,
        isActive,
        keywords: extractKeywords(question + ' ' + answer),
        updatedAt: new Date()
      },
      { new: true }
    );

    if (!faq) {
      return res.status(404).json({ error: 'FAQ not found' });
    }

    res.json({
      message: 'FAQ updated successfully',
      faq
    });

  } catch (error) {
    console.error('FAQ update error:', error);
    res.status(500).json({ error: 'Failed to update FAQ' });
  }
});

// Delete FAQ
router.delete('/faqs/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const faq = await FAQ.findByIdAndDelete(id);

    if (!faq) {
      return res.status(404).json({ error: 'FAQ not found' });
    }

    res.json({
      message: 'FAQ deleted successfully'
    });

  } catch (error) {
    console.error('FAQ deletion error:', error);
    res.status(500).json({ error: 'Failed to delete FAQ' });
  }
});

// Helper function to parse FAQ text
function parseFAQText(text) {
  const faqs = [];
  const lines = text.split('\n').map(line => line.trim()).filter(line => line);
  
  let currentQuestion = '';
  let currentAnswer = '';
  let isAnswer = false;
  
  for (const line of lines) {
    if (line.toLowerCase().startsWith('q:') || line.toLowerCase().startsWith('question:')) {
      // Save previous FAQ if exists
      if (currentQuestion && currentAnswer) {
        faqs.push({
          question: currentQuestion.trim(),
          answer: currentAnswer.trim()
        });
      }
      
      currentQuestion = line.replace(/^(q:|question:)/i, '').trim();
      currentAnswer = '';
      isAnswer = false;
    } else if (line.toLowerCase().startsWith('a:') || line.toLowerCase().startsWith('answer:')) {
      currentAnswer = line.replace(/^(a:|answer:)/i, '').trim();
      isAnswer = true;
    } else if (isAnswer) {
      currentAnswer += ' ' + line;
    } else if (currentQuestion) {
      currentQuestion += ' ' + line;
    }
  }
  
  // Save last FAQ
  if (currentQuestion && currentAnswer) {
    faqs.push({
      question: currentQuestion.trim(),
      answer: currentAnswer.trim()
    });
  }
  
  return faqs;
}

// Helper function to extract keywords
function extractKeywords(text) {
  const words = text.toLowerCase()
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter(word => word.length > 2)
    .filter(word => !['the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by'].includes(word));
    
  return [...new Set(words)].slice(0, 10); // Return unique keywords, max 10
}

export default router;