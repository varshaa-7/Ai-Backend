import mongoose from 'mongoose';

const faqSchema = new mongoose.Schema({
  question: {
    type: String,
    required: true,
    index: 'text'
  },
  answer: {
    type: String,
    required: true
  },
  category: {
    type: String,
    default: 'General'
  },
  keywords: [{
    type: String,
    lowercase: true
  }],
  priority: {
    type: Number,
    default: 1,
    min: 1,
    max: 10
  },
  isActive: {
    type: Boolean,
    default: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

faqSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

faqSchema.index({ question: 'text', answer: 'text', keywords: 'text' });

export default mongoose.model('FAQ', faqSchema);