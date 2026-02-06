'use client';

import { useAuth } from "@clerk/nextjs";
import { useRouter, useParams } from "next/navigation";
import { useState, useEffect } from "react";

interface QuizQuestion {
  question: string;
  wrongAnswers: string[];
  correctAnswer: string;
  explanation: string;
  hint?: string;
}

export default function QuizPage() {
  const { isLoaded, isSignedIn } = useAuth();
  const router = useRouter();
  const params = useParams();
  const [quizQuestions, setQuizQuestions] = useState<QuizQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
  const [quizCompleted, setQuizCompleted] = useState(false);
  const [randomizedAnswers, setRandomizedAnswers] = useState<{ text: string; isCorrect: boolean }[][]>([]);
  const [hintRevealed, setHintRevealed] = useState<boolean[]>([]);
  const [noteTitle, setNoteTitle] = useState('');

  useEffect(() => {
    const initPage = async () => {
      if (isLoaded && !isSignedIn) {
        router.push('/');
        return;
      }

      if (isLoaded && isSignedIn) {
        await fetchNote();
      }
    };

    initPage();
  }, [isLoaded, isSignedIn]);

  const fetchNote = async () => {
    try {
      const { id } = params;
      const response = await fetch(`/api/notes/${id}`);
      if (response.ok) {
        const data = await response.json();
        setNoteTitle(data.title || 'Note');
        const questions = data.quizQuestions || [];
        setQuizQuestions(questions);
        
        if (questions.length > 0) {
        const randomized = questions.map((q: QuizQuestion) => {
          const answers = [
            { text: q.correctAnswer, isCorrect: true },
            ...q.wrongAnswers.map((a: string) => ({ text: a, isCorrect: false }))
          ];
          return answers.sort(() => Math.random() - 0.5);
        });
          setRandomizedAnswers(randomized);
          setCurrentIndex(0);
          setHintRevealed(new Array(questions.length).fill(false));
        }
      } else if (response.status === 404) {
        router.push('/');
      }
    } catch (error) {
      console.error('Failed to fetch note:', error);
    } finally {
      setLoading(false);
    }
  };

  const selectAnswer = (index: number) => {
    setSelectedAnswer(index);
  };

  const revealHint = () => {
    const newHintRevealed = [...hintRevealed];
    newHintRevealed[currentIndex] = true;
    setHintRevealed(newHintRevealed);
  };

  const nextQuestion = () => {
    if (currentIndex < quizQuestions.length - 1) {
      setCurrentIndex(currentIndex + 1);
      setSelectedAnswer(null);
      setHintRevealed(prev => {
        const updated = [...prev];
        updated[currentIndex + 1] = false;
        return updated;
      });
    } else {
      setQuizCompleted(true);
    }
  };

  const restartQuiz = () => {
    const randomized = quizQuestions.map((q: QuizQuestion) => {
      const answers = [
        { text: q.correctAnswer, isCorrect: true },
        ...q.wrongAnswers.map((a: string) => ({ text: a, isCorrect: false }))
      ];
      return answers.sort(() => Math.random() - 0.5);
    });
    setRandomizedAnswers(randomized);
    setCurrentIndex(0);
    setSelectedAnswer(null);
    setQuizCompleted(false);
    setHintRevealed(new Array(quizQuestions.length).fill(false));
  };

  const downloadQuiz = () => {
    const content = JSON.stringify(quizQuestions, null, 2);
    const blob = new Blob([content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${noteTitle.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_quiz.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  if (!isLoaded || loading) {
    return (
      <div className="container">
        <div className="card">
          <p>Loading...</p>
        </div>
      </div>
    );
  }

  if (!isSignedIn) {
    return null;
  }

  return (
    <div className="container">
      <div style={{ marginBottom: '20px', display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
        <button onClick={() => router.back()} className="btn btn-secondary">
          ← Back
        </button>
        <button 
          onClick={() => router.push(`/note/${params.id}`)}
          className="btn btn-secondary"
        >
          📄 Note
        </button>
        <button 
          onClick={() => router.push(`/note/${params.id}/chat`)}
          className="btn btn-secondary"
        >
          💬 Chat
        </button>
        <div style={{ flex: 1 }} />
        <button onClick={downloadQuiz} className="btn btn-primary" disabled={quizQuestions.length === 0}>
          ↓ Save Quiz
        </button>
      </div>

      <div className="card">
        <header style={{ marginBottom: '20px', borderBottom: '1px solid #e2e8f0', paddingBottom: '15px' }}>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '5px' }}>
            📝 Quiz
          </h1>
          <p style={{ color: '#6b7280', fontSize: '14px' }}>
            {noteTitle} • {quizQuestions.length} questions
          </p>
        </header>

        {quizQuestions.length > 0 ? (
          !quizCompleted ? (
            <>
              <div style={{ marginBottom: '15px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>Question {currentIndex + 1} of {quizQuestions.length}</span>
              </div>
              <div className="card" style={{ backgroundColor: '#f8fafc', padding: '30px' }}>
                <h3 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '20px' }}>
                  {quizQuestions[currentIndex]?.question || 'No question available'}
                </h3>
                {selectedAnswer === null && quizQuestions[currentIndex]?.hint && !hintRevealed[currentIndex] && (
                  <button
                    onClick={revealHint}
                    style={{
                      marginBottom: '15px',
                      padding: '8px 16px',
                      backgroundColor: '#fef3c7',
                      border: '1px solid #f59e0b',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontSize: '14px',
                      color: '#92400e'
                    }}
                  >
                    💡 Show Hint
                  </button>
                )}
                {hintRevealed[currentIndex] && quizQuestions[currentIndex]?.hint && (
                  <div style={{
                    marginBottom: '15px',
                    padding: '12px 16px',
                    backgroundColor: '#fef3c7',
                    borderRadius: '6px',
                    fontSize: '14px',
                    color: '#92400e'
                  }}>
                    <strong>Hint:</strong> {quizQuestions[currentIndex]?.hint}
                  </div>
                )}
                <div style={{ display: 'grid', gap: '10px' }}>
                  {randomizedAnswers[currentIndex]?.map((answer, index) => (
                    <button
                      key={index}
                      onClick={() => selectAnswer(index)}
                      style={{
                        padding: '15px 20px',
                        textAlign: 'left',
                        backgroundColor: selectedAnswer === index ? '#dbeafe' : 'white',
                        border: selectedAnswer === index ? '2px solid #3b82f6' : '2px solid #e2e8f0',
                        borderRadius: '8px',
                        cursor: 'pointer',
                        fontSize: '15px',
                        transition: 'all 0.2s'
                      }}
                    >
                      {String.fromCharCode(65 + index)}. {answer.text}
                    </button>
                  ))}
                </div>
                {selectedAnswer !== null && (
                  <div style={{ marginTop: '20px' }}>
                    <div 
                      style={{ 
                        padding: '15px', 
                        backgroundColor: selectedAnswer < randomizedAnswers[currentIndex]?.length && randomizedAnswers[currentIndex][selectedAnswer]?.isCorrect ? '#dcfce7' : '#fee2e2',
                        border: `2px solid ${selectedAnswer < randomizedAnswers[currentIndex]?.length && randomizedAnswers[currentIndex][selectedAnswer]?.isCorrect ? '#22c55e' : '#ef4444'}`,
                        borderRadius: '8px',
                        marginBottom: '15px'
                      }}
                    >
                      <strong>{selectedAnswer < randomizedAnswers[currentIndex]?.length && randomizedAnswers[currentIndex][selectedAnswer]?.isCorrect ? '✓ Correct!' : '✗ Incorrect'}</strong>
                      <p style={{ marginTop: '8px', fontSize: '14px' }}>
                        {quizQuestions[currentIndex]?.explanation}
                      </p>
                    </div>
                    <button onClick={nextQuestion} className="btn btn-primary" style={{ width: '100%' }}>
                      {currentIndex < quizQuestions.length - 1 ? 'Next Question →' : 'See Results'}
                    </button>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="card" style={{ textAlign: 'center', padding: '40px' }}>
              <h3 style={{ fontSize: '24px', fontWeight: 'bold', marginBottom: '20px' }}>
                Quiz Complete! 🎉
              </h3>
              <p style={{ fontSize: '16px', color: '#6b7280', marginBottom: '20px' }}>
                You've completed all {quizQuestions.length} questions.
              </p>
              <button onClick={restartQuiz} className="btn btn-primary">
                Try Again
              </button>
            </div>
          )
        ) : (
          <div style={{ textAlign: 'center', padding: '40px', backgroundColor: '#f8fafc' }}>
            <p style={{ color: '#6b7280' }}>
              No quiz questions available for this note.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
