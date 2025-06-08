import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  password: {
    type: String,
    required: true,
    minlength: 6
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  role: {
    type: String,
    enum: ['user', 'admin'],
    default: 'user'
  },
  isActive: {
    type: Boolean,
    default: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

userSchema.methods.comparePassword = async function(candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

// Create default admin user if none exists
userSchema.statics.createDefaultAdmin = async function() {
  try {
    const adminExists = await this.findOne({ role: 'admin' });
    
    if (!adminExists) {
      const defaultAdmin = new this({
        email: 'admin@example.com',
        password: 'admin123',
        name: 'Admin User',
        role: 'admin'
      });
      
      await defaultAdmin.save();
      console.log('Default admin user created:');
      console.log('Email: admin@example.com');
      console.log('Password: admin123');
    }
  } catch (error) {
    console.error('Error creating default admin:', error);
  }
};

export default mongoose.model('User', userSchema);