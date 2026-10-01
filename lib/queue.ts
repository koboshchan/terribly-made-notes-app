import { randomUUID } from 'crypto';
import { getCollection } from './db';
export type PipelineStage =
  | 'audioNormalization'
  | 'transcription'
  | 'summarization'
  | 'generation';

export interface PipelineSettings {
  audioNormalization: {
    parallel: boolean;
    concurrency?: number;
  };
  transcription: {
    parallel: boolean;
    concurrency?: number;
  };
  summarization: {
    parallel: boolean;
    concurrency?: number;
  };
  generation: {
    parallel: boolean;
    concurrency?: number;
  };
}

export const defaultPipelineSettings: PipelineSettings = {
  audioNormalization: {
    parallel: true,
  },
  transcription: {
    parallel: false,
  },
  summarization: {
    parallel: true,
  },
  generation: {
    parallel: true,
  },
};

export const PIPELINE_STAGES: PipelineStage[] = [
  'audioNormalization',
  'transcription',
  'summarization',
  'generation',
];

export interface QueueItem {
  id: string;
  userId: string;
  noteId: string;
  originalPath: string;
  mp3Path: string;
  markdownPath: string;
  language?: 'english' | 'other';
  status: 'queued' | 'processing' | 'completed' | 'error';
  currentStage: PipelineStage;
  stageStatus: 'waiting' | 'active' | 'completed' | 'error';
  progress: number;
  error?: string;
  transcription?: string;
  summary?: {
    title: string;
    description: string;
    content: string;
    noteClass?: string;
  };
  addedAt: number;
}

class ProcessingQueue {
  private workerId = randomUUID();
  private timer = setInterval(() => { void this.dispatch().catch(console.error); }, 5000).unref();

  private async persist(item: QueueItem): Promise<void> {
    const jobs = await getCollection('processing_jobs');
    await jobs.updateOne({ id: item.id, leaseOwner: this.workerId }, { $set: { ...item, leaseOwner: null, leaseUntil: new Date(0) } });
  }

  async getPersistedProgress(id: string) {
    await this.dispatch();
    const jobs = await getCollection('processing_jobs');
    const job = await jobs.findOne({ id });
    if (!job) return this.getProgress(id);
    return { queueProgress: job.stageStatus === 'active' ? 100 : 0, processProgress: job.progress, percent: job.progress, status: job.status, message: job.error || job.currentStage, error: job.error };
  }
  private queue: QueueItem[] = [];
  private cachedPipelineSettings: PipelineSettings = defaultPipelineSettings;
  private lastSettingsFetch = 0;
  private dispatching = false;
  private needsRedispatch = false;

  addItem(item: {
    id: string;
    userId: string;
    noteId: string;
    originalPath: string;
    mp3Path: string;
    markdownPath: string;
    language?: 'english' | 'other';
  }): void {
    void this.enqueue(item).catch(console.error);
  }

  async enqueue(item: { id: string; userId: string; noteId: string; originalPath: string; mp3Path: string; markdownPath: string; language?: 'english' | 'other' }): Promise<void> {
    const jobs = await getCollection('processing_jobs');
    await jobs.createIndex({ id: 1 }, { unique: true });
    await jobs.createIndex({ stageStatus: 1, leaseUntil: 1, addedAt: 1 });
    await jobs.updateOne({ id: item.id }, { $setOnInsert: { ...item, status: 'queued', currentStage: 'audioNormalization', stageStatus: 'waiting', progress: 0, addedAt: Date.now(), leaseUntil: new Date(0) } }, { upsert: true });
    await this.dispatch();
  }

  async retry(id: string): Promise<boolean> {
    const jobs = await getCollection('processing_jobs');
    const job = await jobs.findOneAndUpdate({ id, stageStatus: 'error', leaseOwner: null }, { $set: { stageStatus: 'waiting', status: 'queued', error: null }, $inc: { attempt: 1 } }, { returnDocument: 'after' });
    if (!job) return false;
    this.queue = this.queue.filter(q => q.id !== id);
    await this.dispatch();
    return true;
  }

  async cancel(id: string): Promise<void> {
    const jobs = await getCollection('processing_jobs');
    await jobs.updateOne({ id }, { $set: { cancelled: true } });
    // Keep the directory until active work acknowledges cancellation or its lease expires.
    for (let i = 0; i < 120; i++) {
      const job = await jobs.findOne({ id });
      if (!job || !job.leaseOwner || job.leaseUntil < new Date()) {
        await jobs.updateOne({ id }, { $set: { stageStatus: 'error', status: 'error', error: 'Cancelled' } });
        this.queue = this.queue.filter(q => q.id !== id);
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    throw new Error('Cancellation is pending; retry deletion after the worker stops');
  }

  private async assertActive(item: QueueItem): Promise<void> {
    const jobs = await getCollection('processing_jobs');
    const job = await jobs.findOne({ id: item.id, leaseOwner: this.workerId, cancelled: { $ne: true } });
    if (!job) throw new Error('Job cancelled or lease lost');
  }

  getItem(id: string): QueueItem | undefined {
    return this.queue.find(item => item.id === id);
  }

  getQueuePosition(id: string): number {
    const item = this.getItem(id);
    if (!item) return 0;
    if (item.stageStatus === 'active' || item.status === 'completed') return 1;

    const aheadInStage = this.queue.filter(
      q => q.currentStage === item.currentStage &&
           (q.stageStatus === 'active' || (q.stageStatus === 'waiting' && q.addedAt < item.addedAt))
    ).length;

    return aheadInStage + 1;
  }

  getQueueLength(): number {
    return this.queue.filter(item => item.status === 'queued' || item.stageStatus === 'waiting').length;
  }

  updatePipelineSettings(settings: Partial<PipelineSettings>): void {
    this.cachedPipelineSettings = {
      ...this.cachedPipelineSettings,
      ...settings,
    };
    this.lastSettingsFetch = Date.now();
    this.dispatch();
  }

  async getPipelineSettings(): Promise<PipelineSettings> {
    const now = Date.now();
    // Cache for 2 seconds to avoid excessive database hits
    if (now - this.lastSettingsFetch < 2000) {
      return this.cachedPipelineSettings;
    }

    try {
      const { getCollection } = await import('./db');
      const globalSettingsCollection = await getCollection('global_settings');
      const globalSettings = await globalSettingsCollection.findOne({ type: 'models' });
      if (globalSettings?.settings?.pipeline) {
        this.cachedPipelineSettings = {
          audioNormalization: {
            parallel: globalSettings.settings.pipeline.audioNormalization?.parallel ?? defaultPipelineSettings.audioNormalization.parallel,
            concurrency: globalSettings.settings.pipeline.audioNormalization?.concurrency,
          },
          transcription: {
            parallel: globalSettings.settings.pipeline.transcription?.parallel ?? defaultPipelineSettings.transcription.parallel,
            concurrency: globalSettings.settings.pipeline.transcription?.concurrency,
          },
          summarization: {
            parallel: globalSettings.settings.pipeline.summarization?.parallel ?? defaultPipelineSettings.summarization.parallel,
            concurrency: globalSettings.settings.pipeline.summarization?.concurrency,
          },
          generation: {
            parallel: globalSettings.settings.pipeline.generation?.parallel ?? defaultPipelineSettings.generation.parallel,
            concurrency: globalSettings.settings.pipeline.generation?.concurrency,
          },
        };
      }
      this.lastSettingsFetch = now;
    } catch {
      // Keep cached on error
    }

    return this.cachedPipelineSettings;
  }

  private async getGlobalModelSettings(): Promise<any> {
    const { getCollection } = await import('./db');
    const globalSettingsCollection = await getCollection('global_settings');
    const globalSettings = await globalSettingsCollection.findOne({ type: 'models' });

    if (!globalSettings || !globalSettings.settings) {
      throw new Error('Global API settings not found. Please ask an administrator to configure API settings.');
    }

    return globalSettings.settings;
  }

  private cleanupOldItems(): void {
    const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
    this.queue = this.queue.filter(item => {
      if (item.status === 'completed' || item.status === 'error') {
        return item.addedAt > tenMinutesAgo;
      }
      return true;
    });
  }

  async dispatch(): Promise<void> {
    if (this.dispatching) {
      this.needsRedispatch = true;
      return;
    }

    this.dispatching = true;

    try {
      do {
        this.needsRedispatch = false;
        const jobs = await getCollection('processing_jobs');
        await jobs.updateMany({ stageStatus: 'active', leaseUntil: { $lt: new Date() } }, { $set: { stageStatus: 'waiting', leaseOwner: null } });
        const pending = await jobs.find({ stageStatus: 'waiting', cancelled: { $ne: true } }).toArray();
        for (const doc of pending) {
          if (!this.queue.some(q => q.id === doc.id && q.stageStatus === 'active')) {
            this.queue = this.queue.filter(q => q.id !== doc.id);
            this.queue.push(doc as unknown as QueueItem);
          }
        }
        this.cleanupOldItems();

        const pipelineSettings = await this.getPipelineSettings();

        for (const stage of PIPELINE_STAGES) {
          const isParallel = pipelineSettings[stage]?.parallel ?? defaultPipelineSettings[stage].parallel;
          const activeItems = this.queue.filter(q => q.currentStage === stage && q.stageStatus === 'active');
          const waitingItems = this.queue.filter(q => q.currentStage === stage && q.stageStatus === 'waiting');

          if (!isParallel) {
            // Sequential mode: exactly 1 item can be active at a time for this stage
            if (activeItems.length === 0 && waitingItems.length > 0) {
              waitingItems.sort((a, b) => a.addedAt - b.addedAt);
              const itemToProcess = waitingItems[0];
              itemToProcess.stageStatus = 'active';
              itemToProcess.status = 'processing';
              this.executeStage(itemToProcess, stage).catch(err => {
                console.error(`Error in stage '${stage}' for item ${itemToProcess.id}:`, err);
              });
            }
          } else {
            // Parallel mode: all waiting items run concurrently (up to safety limit)
            const MAX_CONCURRENT = Math.max(1, Math.min(10, pipelineSettings[stage].concurrency ?? (Number(process.env[`PIPELINE_${stage.toUpperCase()}_CONCURRENCY`]) || 2)));
            const availableSlots = Math.max(0, MAX_CONCURRENT - activeItems.length);
            if (availableSlots > 0 && waitingItems.length > 0) {
              waitingItems.sort((a, b) => a.addedAt - b.addedAt);
              const itemsToProcess = waitingItems.slice(0, availableSlots);
              for (const item of itemsToProcess) {
                item.stageStatus = 'active';
                item.status = 'processing';
                this.executeStage(item, stage).catch(err => {
                  console.error(`Error in stage '${stage}' for item ${item.id}:`, err);
                });
              }
            }
          }
        }
      } while (this.needsRedispatch);
    } finally {
      this.dispatching = false;
    }
  }

  private async executeStage(item: QueueItem, stage: PipelineStage): Promise<void> {
    const jobs = await getCollection('processing_jobs');
    const claim = await jobs.findOneAndUpdate({ id: item.id, stageStatus: 'waiting', cancelled: { $ne: true } }, { $set: { stageStatus: 'active', leaseOwner: this.workerId, leaseUntil: new Date(Date.now() + 60000) } }, { returnDocument: 'after' });
    if (!claim) { this.queue = this.queue.filter(q => q !== item); return; }
    const heartbeat = setInterval(() => { void jobs.updateOne({ id: item.id, leaseOwner: this.workerId }, { $set: { leaseUntil: new Date(Date.now() + 60000), progress: item.progress } }).catch(console.error); }, 15000);
    try {
      await this.assertActive(item);
      if (stage === 'audioNormalization') {
        await this.executeAudioNormalization(item);
      } else if (stage === 'transcription') {
        await this.executeTranscription(item);
      } else if (stage === 'summarization') {
        await this.executeSummarization(item);
      } else if (stage === 'generation') {
        await this.executeGeneration(item);
      }
    } catch (error) {
      console.error(`Processing failed at stage '${stage}' for item ${item.id}:`, error);

      item.status = 'error';
      item.stageStatus = 'error';
      item.error = error instanceof Error ? error.message : 'Unknown error';

      try {
        const { ObjectId } = await import('mongodb');
        const { getCollection } = await import('./db');
        const notesCollection = await getCollection('notes');
        await notesCollection.updateOne(
          { _id: new ObjectId(item.noteId), userId: item.userId },
          {
            $set: {
              status: 'error',
              error: item.error,
              updatedAt: new Date(),
            },
          }
        );
      } catch (dbError) {
        console.error('Failed to update database with error status:', dbError);
      }
    } finally {
      clearInterval(heartbeat);
      await this.persist(item);
      // Trigger dispatch so the next item waiting in this stage or next stage can execute immediately
      this.dispatch();
    }
  }

  private async executeAudioNormalization(item: QueueItem): Promise<void> {
    const { convertAudioToMp3 } = await import('./processing');
    item.progress = 10;

    await convertAudioToMp3(
      item.originalPath,
      item.mp3Path,
      (progress) => {
        item.progress = Math.min(42, Math.round(10 + (progress * 0.3)));
      }
    );

    item.progress = 42;
    item.currentStage = 'transcription';
    item.stageStatus = 'waiting';
  }

  private async executeTranscription(item: QueueItem): Promise<void> {
    const { transcribeAudio } = await import('./processing');
    const settings = await this.getGlobalModelSettings();
    item.progress = 45;

    let selectedModel;
    if (!settings.stt.english && !settings.stt.other) {
      selectedModel = {
        modelName: settings.stt.modelName || 'whisper-1',
        task: settings.stt.task || 'transcribe',
        temperature: settings.stt.temperature || 0.0,
      };
    } else {
      selectedModel = item.language === 'english' ? settings.stt.english : settings.stt.other;
    }

    item.progress = 50;
    const transcription = await transcribeAudio(item.mp3Path, {
      baseUrl: settings.stt.baseUrl,
      apiKey: settings.stt.apiKey,
      modelName: selectedModel.modelName,
      task: selectedModel.task,
      temperature: selectedModel.temperature,
      capabilities: settings.stt.capabilities,
    }, () => this.assertActive(item));

    await this.assertActive(item);
    item.transcription = transcription;
    const { saveFile } = await import('./storage');
    saveFile(item.markdownPath.replace(/\.md$/, '.txt'), transcription);
    item.progress = 70;
    item.currentStage = 'summarization';
    item.stageStatus = 'waiting';
  }

  private async executeSummarization(item: QueueItem): Promise<void> {
    const { summarizeText, saveMarkdownNote } = await import('./processing');
    const { getCollection } = await import('./db');
    const settings = await this.getGlobalModelSettings();

    item.progress = 72;
    const userClassesCollection = await getCollection('user_classes');
    const userClassDocs = await userClassesCollection.find({ userId: item.userId }).toArray();
    const userClasses = userClassDocs.map((doc: any) => doc.name);

    if (!item.transcription) {
      const transcriptPath = item.markdownPath.replace(/\.md$/, '.txt');
      const { readFile, fileExists } = await import('./storage');
      if (fileExists(transcriptPath)) {
        item.transcription = readFile(transcriptPath).toString('utf-8');
      } else {
        throw new Error('Transcription missing for summarization step');
      }
    }

    item.progress = 75;
    const summary = await summarizeText(item.transcription, settings.llm, userClasses, 'summarization');
    await this.assertActive(item);
    item.summary = summary;
    item.progress = 90;

    await saveMarkdownNote(item.markdownPath, summary.content);
    item.progress = 92;

    const transcriptPath = item.markdownPath.replace(/\.md$/, '.txt');
    await saveMarkdownNote(transcriptPath, item.transcription);

    item.currentStage = 'generation';
    item.stageStatus = 'waiting';
  }

  private async executeGeneration(item: QueueItem): Promise<void> {
    const { generateFlashcards, generateQuiz } = await import('./processing');
    const { deleteFile } = await import('./storage');
    const { getCollection } = await import('./db');
    const { ObjectId } = await import('mongodb');
    const settings = await this.getGlobalModelSettings();

    item.progress = 93;

    if (!item.summary?.content) {
      const { readFile, fileExists } = await import('./storage');
      if (fileExists(item.markdownPath)) {
        const content = readFile(item.markdownPath).toString('utf-8');
        item.summary = {
          title: 'Note',
          description: '',
          content,
        };
      } else {
        throw new Error('Summary content missing for study materials generation');
      }
    }

    const notesCollection = await getCollection('notes');
    const note = await notesCollection.findOne({ _id: new ObjectId(item.noteId), userId: item.userId });
    const preferences = note?.processingPreferences || settings.studyPreferences || {};
    const [cardsResult, quizResult] = await Promise.allSettled([
      preferences.flashcards === false ? Promise.resolve([]) : note?.studyOutcomes?.flashcards === 'completed' ? Promise.resolve(note.flashcards) : generateFlashcards(item.summary.content, settings.llm),
      preferences.quiz === false ? Promise.resolve([]) : note?.studyOutcomes?.quiz === 'completed' ? Promise.resolve(note.quizQuestions) : generateQuiz(item.summary.content, settings.llm),
    ]);
    const flashcards = cardsResult.status === 'fulfilled' ? cardsResult.value : note?.flashcards || [];
    const quizQuestions = quizResult.status === 'fulfilled' ? quizResult.value : note?.quizQuestions || [];
    const failed = cardsResult.status === 'rejected' || quizResult.status === 'rejected';
    const studyOutcomes = { summary: 'completed', flashcards: cardsResult.status === 'fulfilled' ? 'completed' : 'error', quiz: quizResult.status === 'fulfilled' ? 'completed' : 'error' };
    await this.assertActive(item);
    item.progress = 98;
    const updateData: any = {
      title: item.summary.title,
      description: item.summary.description,
      content: item.summary.content,
      flashcards,
      quizQuestions,
      studyOutcomes,
      status: failed ? 'error' : 'completed',
      updatedAt: new Date(),
    };

    const existingNote = await notesCollection.findOne({ _id: new ObjectId(item.noteId), userId: item.userId });
    if (item.summary.noteClass && existingNote?.classificationSource !== 'manual') {
      updateData.noteClass = item.summary.noteClass;
    }

    await notesCollection.updateOne(
      { _id: new ObjectId(item.noteId), userId: item.userId },
      { $set: updateData }
    );

    if (failed) throw new Error('Some study materials failed; retry resumes only missing outcomes');

    // Clean up original raw audio to save space
    deleteFile(item.originalPath);

    item.status = 'completed';
    item.stageStatus = 'completed';
    item.progress = 100;
  }

  getProgress(id: string): {
    queueProgress: number;
    processProgress: number;
    status: string;
    message?: string;
    percent?: number;
    error?: string;
  } {
    const item = this.getItem(id);
    if (!item) {
      return {
        queueProgress: 0,
        processProgress: 0,
        status: 'not found',
        message: 'Not found',
        percent: 0,
      };
    }

    if (item.status === 'completed') {
      return {
        queueProgress: 100,
        processProgress: 100,
        status: 'completed',
        message: 'Complete',
        percent: 100,
      };
    }

    if (item.status === 'error') {
      return {
        queueProgress: 0,
        processProgress: item.progress,
        status: `Error: ${item.error}`,
        message: item.error || 'Processing failed',
        percent: item.progress,
        error: item.error,
      };
    }

    const stage = item.currentStage;
    const isWaiting = item.stageStatus === 'waiting';

    const aheadInStage = isWaiting
      ? this.queue.filter(
          q => q.currentStage === stage &&
               (q.stageStatus === 'active' || (q.stageStatus === 'waiting' && q.addedAt < item.addedAt))
        ).length
      : 0;

    let detailedStatus = '';
    if (stage === 'audioNormalization') {
      if (isWaiting) {
        detailedStatus = aheadInStage > 0
          ? `Waiting in queue for audio conversion (position ${aheadInStage + 1})...`
          : 'Waiting for audio conversion...';
      } else {
        detailedStatus = `Converting audio to MP3... (${Math.round(item.progress)}%)`;
      }
    } else if (stage === 'transcription') {
      if (isWaiting) {
        detailedStatus = aheadInStage > 0
          ? `Waiting in queue for transcription (position ${aheadInStage + 1})...`
          : 'Waiting for transcription...';
      } else {
        detailedStatus = `Transcribing audio to text... (${Math.round(item.progress)}%)`;
      }
    } else if (stage === 'summarization') {
      if (isWaiting) {
        detailedStatus = aheadInStage > 0
          ? `Waiting in queue for AI summary (position ${aheadInStage + 1})...`
          : 'Waiting for AI summary...';
      } else {
        detailedStatus = `Generating AI summary... (${Math.round(item.progress)}%)`;
      }
    } else if (stage === 'generation') {
      if (isWaiting) {
        detailedStatus = aheadInStage > 0
          ? `Waiting in queue for study materials...`
          : 'Waiting for study materials...';
      } else {
        detailedStatus = `Generating flashcards & quiz... (${Math.round(item.progress)}%)`;
      }
    }

    const queueProgress = item.stageStatus === 'active'
      ? 100
      : Math.max(10, 100 - (aheadInStage * 25));

    return {
      queueProgress,
      processProgress: item.progress,
      status: detailedStatus,
      message: detailedStatus,
      percent: Math.round(item.progress),
    };
  }
}

export const processingQueue = new ProcessingQueue();
