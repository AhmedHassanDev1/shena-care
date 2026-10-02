'use client';

import { useState } from 'react';

type Step = 'category' | 'goal' | 'type' | 'constraints' | 'budget' | 'preview';

type RoutineState = {
  category: string;
  goal: string;
  type: string;
  constraints: string[];
  budget: string;
};

const STEPS: Step[] = ['category', 'goal', 'type', 'constraints', 'budget', 'preview'];

export default function RoutineBuilderPage() {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  
  const [state, setState] = useState<RoutineState>({
    category: '',
    goal: '',
    type: '',
    constraints: [],
    budget: '',
  });

  const step = STEPS[currentStepIndex];

  const handleNext = () => {
    if (currentStepIndex < STEPS.length - 1) {
      setCurrentStepIndex(i => i + 1);
    }
  };

  const handleBack = () => {
    if (currentStepIndex > 0) {
      setCurrentStepIndex(i => i - 1);
    }
  };

  const setField = (field: keyof RoutineState, value: string) => {
    setState(s => ({ ...s, [field]: value }));
  };

  const toggleConstraint = (value: string) => {
    setState(s => ({
      ...s,
      constraints: s.constraints.includes(value) 
        ? s.constraints.filter(c => c !== value)
        : [...s.constraints, value]
    }));
  };

  const renderStepContent = () => {
    switch (step) {
      case 'category':
        return (
          <div>
            <h2 style={{ fontSize: '1.5rem', marginBottom: '1.5rem' }}>What are we focusing on today?</h2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              {['Skin Care', 'Hair Care', 'Body Care'].map(opt => (
                <button
                  key={opt}
                  onClick={() => { setField('category', opt); handleNext(); }}
                  style={{
                    padding: '2rem 1rem',
                    background: state.category === opt ? 'var(--color-primary-light)' : 'var(--color-surface)',
                    border: `2px solid ${state.category === opt ? 'var(--color-primary)' : 'var(--color-border)'}`,
                    borderRadius: '1rem',
                    fontSize: '1.1rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'all 0.2s'
                  }}
                >
                  {opt}
                </button>
              ))}
            </div>
          </div>
        );
      
      case 'goal':
        return (
          <div>
            <h2 style={{ fontSize: '1.5rem', marginBottom: '1.5rem' }}>Primary goal?</h2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '0.75rem' }}>
              {['Acne / Blemishes', 'Anti-aging', 'Hydration', 'Brightening / Pigmentation', 'Redness / Sensitivity'].map(opt => (
                <button
                  key={opt}
                  onClick={() => { setField('goal', opt); handleNext(); }}
                  style={{
                    padding: '1rem',
                    background: state.goal === opt ? 'var(--color-primary-light)' : 'var(--color-surface)',
                    border: `2px solid ${state.goal === opt ? 'var(--color-primary)' : 'var(--color-border)'}`,
                    borderRadius: '0.75rem',
                    textAlign: 'left',
                    fontWeight: 500,
                    cursor: 'pointer'
                  }}
                >
                  {opt}
                </button>
              ))}
              <button
                style={{ marginTop: '1rem', background: 'none', border: 'none', color: 'var(--color-text-light)', textDecoration: 'underline', cursor: 'pointer' }}
                onClick={() => alert("Guidance modal would open here to help you figure it out.")}
              >
                مش عارف (I don't know)
              </button>
            </div>
          </div>
        );

      case 'type':
        return (
          <div>
            <h2 style={{ fontSize: '1.5rem', marginBottom: '1.5rem' }}>What's your {state.category === 'Hair Care' ? 'hair' : 'skin'} type?</h2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              {['Dry', 'Oily', 'Combination', 'Normal'].map(opt => (
                <button
                  key={opt}
                  onClick={() => { setField('type', opt); handleNext(); }}
                  style={{
                    padding: '1.5rem 1rem',
                    background: state.type === opt ? 'var(--color-primary-light)' : 'var(--color-surface)',
                    border: `2px solid ${state.type === opt ? 'var(--color-primary)' : 'var(--color-border)'}`,
                    borderRadius: '0.75rem',
                    cursor: 'pointer'
                  }}
                >
                  {opt}
                </button>
              ))}
            </div>
          </div>
        );

      case 'constraints':
        return (
          <div>
            <h2 style={{ fontSize: '1.5rem', marginBottom: '1.5rem' }}>Any specific constraints? (Select all that apply)</h2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '0.75rem' }}>
              {['Pregnancy Safe', 'Fragrance Free', 'Vegan', 'Fungal Acne Safe'].map(opt => (
                <label key={opt} style={{ 
                  display: 'flex', alignItems: 'center', padding: '1rem',
                  background: 'var(--color-surface)', border: '1px solid var(--color-border)',
                  borderRadius: '0.5rem', cursor: 'pointer'
                }}>
                  <input 
                    type="checkbox" 
                    checked={state.constraints.includes(opt)}
                    onChange={() => toggleConstraint(opt)}
                    style={{ marginRight: '1rem', width: '1.25rem', height: '1.25rem' }}
                  />
                  {opt}
                </label>
              ))}
            </div>
            <button onClick={handleNext} className="cta-button" style={{ width: '100%', marginTop: '2rem' }}>Continue</button>
          </div>
        );

      case 'budget':
        return (
          <div>
            <h2 style={{ fontSize: '1.5rem', marginBottom: '1.5rem' }}>What's your ideal budget?</h2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '0.75rem' }}>
              {[
                { id: 'budget', label: 'Budget-Friendly ($10 - $30)', desc: 'Affordable essentials that get the job done.' },
                { id: 'mid', label: 'Mid-Range ($30 - $75)', desc: 'Dermatologist-recommended and clinically backed.' },
                { id: 'premium', label: 'Premium ($75+)', desc: 'Luxury textures and advanced formulations.' }
              ].map(opt => (
                <button
                  key={opt.id}
                  onClick={() => { setField('budget', opt.id); handleNext(); }}
                  style={{
                    padding: '1.5rem 1rem',
                    background: state.budget === opt.id ? 'var(--color-primary-light)' : 'var(--color-surface)',
                    border: `2px solid ${state.budget === opt.id ? 'var(--color-primary)' : 'var(--color-border)'}`,
                    borderRadius: '0.75rem',
                    textAlign: 'left',
                    cursor: 'pointer'
                  }}
                >
                  <div style={{ fontWeight: 600, marginBottom: '0.25rem', fontSize: '1.1rem' }}>{opt.label}</div>
                  <div style={{ color: 'var(--color-text-light)', fontSize: '0.85rem' }}>{opt.desc}</div>
                </button>
              ))}
            </div>
          </div>
        );

      case 'preview':
        return (
          <div>
            <h2 style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>Your Custom Routine</h2>
            <p style={{ color: 'var(--color-text-light)', marginBottom: '1.5rem' }}>Based on your {state.type} {state.category.toLowerCase()} targeting {state.goal.toLowerCase()}.</p>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '2rem' }}>
              {/* Mock Proposal Pattern */}
              <div style={{ background: 'var(--color-surface)', padding: '1rem', borderRadius: '0.75rem', border: '1px solid var(--color-border)', display: 'flex', gap: '1rem' }}>
                <div style={{ width: '60px', height: '60px', background: 'var(--color-bg-alt)', borderRadius: '0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Step 1</div>
                <div>
                  <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-primary)', textTransform: 'uppercase' }}>Cleanse</div>
                  <div style={{ fontWeight: 500 }}>Gentle Hydrating Cleanser</div>
                  <div style={{ color: 'var(--color-text-light)', fontSize: '0.85rem' }}>$15.00</div>
                </div>
              </div>
              <div style={{ background: 'var(--color-surface)', padding: '1rem', borderRadius: '0.75rem', border: '1px solid var(--color-border)', display: 'flex', gap: '1rem' }}>
                <div style={{ width: '60px', height: '60px', background: 'var(--color-bg-alt)', borderRadius: '0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Step 2</div>
                <div>
                  <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-primary)', textTransform: 'uppercase' }}>Treat</div>
                  <div style={{ fontWeight: 500 }}>Niacinamide Serum 10%</div>
                  <div style={{ color: 'var(--color-text-light)', fontSize: '0.85rem' }}>$20.00</div>
                </div>
              </div>
              <div style={{ background: 'var(--color-surface)', padding: '1rem', borderRadius: '0.75rem', border: '1px solid var(--color-border)', display: 'flex', gap: '1rem' }}>
                <div style={{ width: '60px', height: '60px', background: 'var(--color-bg-alt)', borderRadius: '0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Step 3</div>
                <div>
                  <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-primary)', textTransform: 'uppercase' }}>Protect</div>
                  <div style={{ fontWeight: 500 }}>Daily SPF 50 Mineral Sunscreen</div>
                  <div style={{ color: 'var(--color-text-light)', fontSize: '0.85rem' }}>$25.00</div>
                </div>
              </div>
            </div>

            {/* AI Modification Hooks */}
            <div style={{ background: 'var(--color-bg-alt)', padding: '1rem', borderRadius: '0.75rem', marginBottom: '2rem' }}>
              <div style={{ fontWeight: 600, marginBottom: '0.75rem', fontSize: '0.9rem' }}>✨ Refine this routine (AI)</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                <button style={{ padding: '0.4rem 0.8rem', borderRadius: '1rem', border: '1px solid var(--color-border)', background: 'var(--color-surface)', fontSize: '0.8rem', cursor: 'pointer' }}>
                  خلّيه أرخص (Make it cheaper)
                </button>
                <button style={{ padding: '0.4rem 0.8rem', borderRadius: '1rem', border: '1px solid var(--color-border)', background: 'var(--color-surface)', fontSize: '0.8rem', cursor: 'pointer' }}>
                  قلّل الخطوات (Fewer steps)
                </button>
              </div>
            </div>

            <button onClick={() => alert("Added to cart!")} className="cta-button" style={{ width: '100%' }}>
              Add Full Routine to Cart - $60.00
            </button>
          </div>
        );
    }
  };

  return (
    <div style={{ maxWidth: '600px', margin: '0 auto', padding: '2rem 1rem' }}>
      {/* Header & Progress */}
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: '2rem' }}>
        {currentStepIndex > 0 && currentStepIndex < STEPS.length - 1 && (
          <button onClick={handleBack} style={{ background: 'none', border: 'none', cursor: 'pointer', marginRight: '1rem', fontSize: '1.2rem' }}>
            ← 
          </button>
        )}
        <div style={{ flex: 1, display: 'flex', gap: '0.25rem' }}>
          {STEPS.map((s, idx) => (
            <div 
              key={s} 
              style={{ 
                height: '4px', 
                flex: 1, 
                borderRadius: '2px',
                background: idx <= currentStepIndex ? 'var(--color-primary)' : 'var(--color-bg-alt)',
                transition: 'background 0.3s'
              }} 
            />
          ))}
        </div>
      </div>

      {/* Main Content Area */}
      <div style={{ minHeight: '400px' }}>
        {renderStepContent()}
      </div>
    </div>
  );
}
