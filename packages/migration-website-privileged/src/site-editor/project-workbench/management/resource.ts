"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type DependencyList,
} from "react";
import { ManagementApiError } from "./api";

export type ResourceStatus =
  | "loading"
  | "ready"
  | "empty"
  | "error"
  | "forbidden"
  | "unavailable";

export interface ResourceState<T> {
  status: ResourceStatus;
  data: T | null;
  error: ManagementApiError | null;
}

export function normalizeManagementError(error: unknown): ManagementApiError {
  if (error instanceof ManagementApiError) return error;
  if (error instanceof Error) {
    return new ManagementApiError(error.message, {
      endpoint: "unknown",
      kind: "server",
    });
  }
  return new ManagementApiError("The project API returned an unknown error.", {
    endpoint: "unknown",
    kind: "server",
  });
}

function statusForError(error: ManagementApiError): ResourceStatus {
  if (error.kind === "forbidden" || error.kind === "unauthenticated") {
    return "forbidden";
  }
  if (error.kind === "unavailable" || error.kind === "network") {
    return "unavailable";
  }
  return "error";
}

export function useApiResource<T>(
  loader: () => Promise<T>,
  dependencies: DependencyList,
  options?: { isEmpty?: (data: T) => boolean; enabled?: boolean },
): ResourceState<T> & { reload: () => Promise<T | null> } {
  const [state, setState] = useState<ResourceState<T>>({
    status: "loading",
    data: null,
    error: null,
  });
  const generation = useRef(0);
  const loaderRef = useRef(loader);
  const emptyRef = useRef(options?.isEmpty);
  loaderRef.current = loader;
  emptyRef.current = options?.isEmpty;

  const load = useCallback(async (retainData: boolean) => {
    const request = ++generation.current;
    setState((current) => ({
      status: "loading",
      data: retainData ? current.data : null,
      error: null,
    }));
    try {
      const data = await loaderRef.current();
      if (request !== generation.current) return null;
      setState({
        status: emptyRef.current?.(data) ? "empty" : "ready",
        data,
        error: null,
      });
      return data;
    } catch (unknownError) {
      if (request !== generation.current) return null;
      const error = normalizeManagementError(unknownError);
      setState((current) => ({
        status: statusForError(error),
        data: retainData ? current.data : null,
        error,
      }));
      return null;
    }
  }, []);
  const reload = useCallback(() => load(true), [load]);

  useEffect(() => {
    if (options?.enabled === false) {
      generation.current += 1;
      setState({
        status: "loading",
        data: null,
        error: null,
      });
      return;
    }
    void load(false);
    return () => {
      generation.current += 1;
    };
    // Callers define the resource identity through dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, options?.enabled, ...dependencies]);

  return { ...state, reload };
}

export interface ActionState<T> {
  running: boolean;
  error: ManagementApiError | null;
  result: T | null;
  run: (action: () => Promise<T>) => Promise<T | null>;
  clear: () => void;
}

export function useApiAction<T = unknown>(): ActionState<T> {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<ManagementApiError | null>(null);
  const [result, setResult] = useState<T | null>(null);
  const generation = useRef(0);
  const active = useRef(false);

  const run = useCallback(async (action: () => Promise<T>) => {
    if (active.current) return null;
    active.current = true;
    const request = ++generation.current;
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const next = await action();
      if (request !== generation.current) return null;
      setResult(next);
      return next;
    } catch (unknownError) {
      const nextError = normalizeManagementError(unknownError);
      if (request !== generation.current) return null;
      setError(nextError);
      return null;
    } finally {
      if (request === generation.current) {
        active.current = false;
        setRunning(false);
      }
    }
  }, []);

  const clear = useCallback(() => {
    generation.current += 1;
    active.current = false;
    setRunning(false);
    setError(null);
    setResult(null);
  }, []);

  useEffect(
    () => () => {
      generation.current += 1;
      active.current = false;
    },
    [],
  );

  return { running, error, result, run, clear };
}
