import AsyncStorage from '@react-native-async-storage/async-storage';
import { ModelDefinition, Session } from './types';

const SESSION_KEY = 'neuroflow.sessions.v1';
const MODEL_KEY = 'neuroflow.models.v1';
export const loadSessions = async (): Promise<Session[]> => JSON.parse((await AsyncStorage.getItem(SESSION_KEY)) ?? '[]');
export const saveSessions = async (sessions: Session[]) => AsyncStorage.setItem(SESSION_KEY, JSON.stringify(sessions));
export const loadModels = async (): Promise<ModelDefinition[]> => JSON.parse((await AsyncStorage.getItem(MODEL_KEY)) ?? '[]');
export const saveModels = async (models: ModelDefinition[]) => AsyncStorage.setItem(MODEL_KEY, JSON.stringify(models));
