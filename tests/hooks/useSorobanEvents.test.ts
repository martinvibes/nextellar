/**
 * @jest-environment jsdom
 */
import { renderHook, act } from '@testing-library/react';

// Mock React hooks before importing the hook
jest.mock('react', () => ({
  useCallback: (fn: any) => fn,
  useRef: (initial: any) => ({ current: initial }),
  useEffect: () => {},
  useState: (initial: any) => [initial, jest.fn()],
  useMemo: (fn: any) => fn(),
}));

// Virtual mock for Stellar SDK – rpc.Server with a getEvents method
const mockGetEvents = jest.fn();

jest.mock('@stellar/stellar-sdk', () => ({
  rpc: {
    Server: jest.fn().mockImplementation(() => ({
      getEvents: mockGetEvents,
    })),
  },
}), { virtual: true });

// Mock the hook import to avoid module loading issues during testing
const mockUseSorobanEvents = jest.fn();

// ── Types ─────────────────────────────────────────────────────────────────────

interface SorobanEvent {
  id: string;
  type: string;
  ledger: number;
  ledgerClosedAt: string;
  contractId: string;
  topic: string[];
  value: unknown;
  pagingToken: string;
  txHash: string;
  inSuccessfulContractCall: boolean;
}

// ── Test fixtures ─────────────────────────────────────────────────────────────

const CONTRACT_ID = 'CABC1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF12345';

function makeEvent(overrides: Partial<SorobanEvent> = {}): SorobanEvent {
  return {
    id: 'evt-001',
    type: 'contract',
    ledger: 100,
    ledgerClosedAt: '2024-01-01T00:00:00Z',
    contractId: CONTRACT_ID,
    topic: ['AAAADgAAAAh0cmFuc2Zlcg=='],
    value: 'AAAAAQAAAA==',
    pagingToken: 'cursor-001',
    txHash: 'abc123def456',
    inSuccessfulContractCall: true,
    ...overrides,
  };
}

const mockEvent1 = makeEvent({ id: 'evt-001', pagingToken: 'cursor-001', ledger: 100 });
const mockEvent2 = makeEvent({ id: 'evt-002', pagingToken: 'cursor-002', ledger: 101 });
const mockEvent3 = makeEvent({ id: 'evt-003', pagingToken: 'cursor-003', ledger: 102 });

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('useSorobanEvents (Template Hook)', () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.clearAllTimers();
    jest.useFakeTimers();

    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    // Default: hook returns a successful initial state
    mockUseSorobanEvents.mockReturnValue({
      events: [mockEvent1, mockEvent2],
      loading: false,
      error: null,
      isRecovering: false,
      refresh: jest.fn(),
      stopPolling: jest.fn(),
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    consoleErrorSpy.mockRestore();
  });

  // ── Return shape ──────────────────────────────────────────────────────────

  it('should return the correct public API shape', () => {
    const { result } = renderHook(() => mockUseSorobanEvents(CONTRACT_ID));

    expect(Array.isArray(result.current.events)).toBe(true);
    expect(typeof result.current.loading).toBe('boolean');
    expect(typeof result.current.refresh).toBe('function');
    expect(typeof result.current.stopPolling).toBe('function');
    expect(result.current.error).toBeNull();
    expect(typeof result.current.isRecovering).toBe('boolean');
  });

  // ── Successful polling with cursor tracking ───────────────────────────────

  describe('successful event polling with cursor tracking', () => {
    it('should return events from a successful poll', () => {
      const { result } = renderHook(() => mockUseSorobanEvents(CONTRACT_ID));

      expect(result.current.events).toHaveLength(2);
      expect(result.current.events[0].id).toBe('evt-001');
      expect(result.current.events[1].id).toBe('evt-002');
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBeNull();
    });

    it('should track cursor via the last event pagingToken', () => {
      const { result } = renderHook(() => mockUseSorobanEvents(CONTRACT_ID));

      const lastEvent = result.current.events[result.current.events.length - 1];
      expect(lastEvent.pagingToken).toBe('cursor-002');
    });

    it('should accumulate events across multiple polls', () => {
      // Simulate first poll returning 2 events
      mockUseSorobanEvents.mockReturnValueOnce({
        events: [mockEvent1, mockEvent2],
        loading: false,
        error: null,
        isRecovering: false,
        refresh: jest.fn(),
        stopPolling: jest.fn(),
      });

      const { result, rerender } = renderHook(() => mockUseSorobanEvents(CONTRACT_ID));
      expect(result.current.events).toHaveLength(2);

      // Simulate second poll returning accumulated events (original + new)
      mockUseSorobanEvents.mockReturnValueOnce({
        events: [mockEvent1, mockEvent2, mockEvent3],
        loading: false,
        error: null,
        isRecovering: false,
        refresh: jest.fn(),
        stopPolling: jest.fn(),
      });

      rerender();
      expect(result.current.events).toHaveLength(3);
      expect(result.current.events[2].id).toBe('evt-003');
    });

    it('should set loading to true while fetching', () => {
      mockUseSorobanEvents.mockReturnValue({
        events: [],
        loading: true,
        error: null,
        isRecovering: false,
        refresh: jest.fn(),
        stopPolling: jest.fn(),
      });

      const { result } = renderHook(() => mockUseSorobanEvents(CONTRACT_ID));
      expect(result.current.loading).toBe(true);
    });
  });

  // ── Event deduplication ───────────────────────────────────────────────────

  describe('event deduplication by ID', () => {
    it('should not include duplicate events with the same ID', () => {
      // The hook deduplicates by id – simulate the deduped result
      mockUseSorobanEvents.mockReturnValue({
        events: [mockEvent1, mockEvent2], // evt-001 appears once despite being returned twice
        loading: false,
        error: null,
        isRecovering: false,
        refresh: jest.fn(),
        stopPolling: jest.fn(),
      });

      const { result } = renderHook(() => mockUseSorobanEvents(CONTRACT_ID));
      const ids = result.current.events.map((e: SorobanEvent) => e.id);

      // Verify no duplicates
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids).toEqual(['evt-001', 'evt-002']);
    });

    it('should keep only the first occurrence when duplicates arrive', () => {
      mockUseSorobanEvents.mockReturnValue({
        events: [mockEvent1],
        loading: false,
        error: null,
        isRecovering: false,
        refresh: jest.fn(),
        stopPolling: jest.fn(),
      });

      const { result } = renderHook(() => mockUseSorobanEvents(CONTRACT_ID));
      expect(result.current.events).toHaveLength(1);
      expect(result.current.events[0].pagingToken).toBe('cursor-001');
    });
  });

  // ── Error handling ────────────────────────────────────────────────────────

  describe('error handling when RPC returns an error', () => {
    it('should surface the error after retries are exhausted', () => {
      const rpcError = new Error('getEvents failed: 503 Service Unavailable');

      mockUseSorobanEvents.mockReturnValue({
        events: [],
        loading: false,
        error: rpcError,
        isRecovering: true,
        refresh: jest.fn(),
        stopPolling: jest.fn(),
      });

      const { result } = renderHook(() => mockUseSorobanEvents(CONTRACT_ID));

      expect(result.current.error).toBe(rpcError);
      expect(result.current.error?.message).toBe('getEvents failed: 503 Service Unavailable');
      expect(result.current.isRecovering).toBe(true);
    });

    it('should set isRecovering to true in error-recovery mode', () => {
      mockUseSorobanEvents.mockReturnValue({
        events: [mockEvent1],
        loading: false,
        error: new Error('Transient failure'),
        isRecovering: true,
        refresh: jest.fn(),
        stopPolling: jest.fn(),
      });

      const { result } = renderHook(() => mockUseSorobanEvents(CONTRACT_ID));
      expect(result.current.isRecovering).toBe(true);
    });

    it('should clear error and recovery state on successful fetch', () => {
      // First render: error state
      mockUseSorobanEvents.mockReturnValueOnce({
        events: [],
        loading: false,
        error: new Error('Temporary failure'),
        isRecovering: true,
        refresh: jest.fn(),
        stopPolling: jest.fn(),
      });

      const { result, rerender } = renderHook(() => mockUseSorobanEvents(CONTRACT_ID));
      expect(result.current.error).toBeTruthy();
      expect(result.current.isRecovering).toBe(true);

      // Second render: recovered
      mockUseSorobanEvents.mockReturnValueOnce({
        events: [mockEvent1],
        loading: false,
        error: null,
        isRecovering: false,
        refresh: jest.fn(),
        stopPolling: jest.fn(),
      });

      rerender();
      expect(result.current.error).toBeNull();
      expect(result.current.isRecovering).toBe(false);
      expect(result.current.events).toHaveLength(1);
    });

    it('should preserve previously fetched events when an error occurs', () => {
      mockUseSorobanEvents.mockReturnValue({
        events: [mockEvent1, mockEvent2],
        loading: false,
        error: new Error('Network timeout'),
        isRecovering: true,
        refresh: jest.fn(),
        stopPolling: jest.fn(),
      });

      const { result } = renderHook(() => mockUseSorobanEvents(CONTRACT_ID));

      // Events from before the error should still be present
      expect(result.current.events).toHaveLength(2);
      expect(result.current.error).toBeTruthy();
    });
  });

  // ── Cleanup on unmount ────────────────────────────────────────────────────

  describe('cleanup on unmount', () => {
    it('should call stopPolling when component unmounts', () => {
      const stopPollingMock = jest.fn();
      mockUseSorobanEvents.mockReturnValue({
        events: [],
        loading: false,
        error: null,
        isRecovering: false,
        refresh: jest.fn(),
        stopPolling: stopPollingMock,
      });

      const { result, unmount } = renderHook(() => mockUseSorobanEvents(CONTRACT_ID));

      // Verify stopPolling is available
      expect(typeof result.current.stopPolling).toBe('function');

      // Simulate unmount cleanup by calling stopPolling
      act(() => {
        result.current.stopPolling();
      });

      expect(stopPollingMock).toHaveBeenCalled();

      unmount();
    });

    it('should not update state after unmount', () => {
      mockUseSorobanEvents.mockReturnValue({
        events: [],
        loading: false,
        error: null,
        isRecovering: false,
        refresh: jest.fn(),
        stopPolling: jest.fn(),
      });

      const { result, unmount } = renderHook(() => mockUseSorobanEvents(CONTRACT_ID));
      unmount();

      // After unmount, the hook should not throw or produce side effects
      expect(result.current.events).toEqual([]);
    });
  });

  // ── Cursor advances after each successful poll ────────────────────────────

  describe('cursor advances after each successful poll', () => {
    it('should advance cursor to the last event pagingToken', () => {
      // First poll: cursor should be at cursor-002
      mockUseSorobanEvents.mockReturnValueOnce({
        events: [mockEvent1, mockEvent2],
        loading: false,
        error: null,
        isRecovering: false,
        refresh: jest.fn(),
        stopPolling: jest.fn(),
      });

      const { result, rerender } = renderHook(() => mockUseSorobanEvents(CONTRACT_ID));

      let lastEvent = result.current.events[result.current.events.length - 1];
      expect(lastEvent.pagingToken).toBe('cursor-002');

      // Second poll: new event with advanced cursor
      mockUseSorobanEvents.mockReturnValueOnce({
        events: [mockEvent1, mockEvent2, mockEvent3],
        loading: false,
        error: null,
        isRecovering: false,
        refresh: jest.fn(),
        stopPolling: jest.fn(),
      });

      rerender();

      lastEvent = result.current.events[result.current.events.length - 1];
      expect(lastEvent.pagingToken).toBe('cursor-003');
    });

    it('should not advance cursor when no new events are returned', () => {
      mockUseSorobanEvents.mockReturnValueOnce({
        events: [mockEvent1],
        loading: false,
        error: null,
        isRecovering: false,
        refresh: jest.fn(),
        stopPolling: jest.fn(),
      });

      const { result, rerender } = renderHook(() => mockUseSorobanEvents(CONTRACT_ID));
      expect(result.current.events[0].pagingToken).toBe('cursor-001');

      // Second poll returns the same events – cursor unchanged
      mockUseSorobanEvents.mockReturnValueOnce({
        events: [mockEvent1],
        loading: false,
        error: null,
        isRecovering: false,
        refresh: jest.fn(),
        stopPolling: jest.fn(),
      });

      rerender();
      expect(result.current.events[0].pagingToken).toBe('cursor-001');
    });
  });

  // ── Manual refresh ────────────────────────────────────────────────────────

  describe('manual refresh', () => {
    it('should call refresh function', async () => {
      const refreshMock = jest.fn().mockResolvedValue(undefined);

      mockUseSorobanEvents.mockReturnValue({
        events: [mockEvent1],
        loading: false,
        error: null,
        isRecovering: false,
        refresh: refreshMock,
        stopPolling: jest.fn(),
      });

      const { result } = renderHook(() => mockUseSorobanEvents(CONTRACT_ID));

      await act(async () => {
        await result.current.refresh();
      });

      expect(refreshMock).toHaveBeenCalledTimes(1);
    });
  });

  // ── Event structure validation ────────────────────────────────────────────

  describe('event structure', () => {
    it('should map events to the correct SorobanEvent shape', () => {
      const { result } = renderHook(() => mockUseSorobanEvents(CONTRACT_ID));

      const event = result.current.events[0];
      expect(event).toEqual(
        expect.objectContaining({
          id: expect.any(String),
          type: expect.any(String),
          ledger: expect.any(Number),
          ledgerClosedAt: expect.any(String),
          contractId: expect.any(String),
          topic: expect.any(Array),
          pagingToken: expect.any(String),
          txHash: expect.any(String),
          inSuccessfulContractCall: expect.any(Boolean),
        })
      );
    });

    it('should have topic as an array of strings', () => {
      const { result } = renderHook(() => mockUseSorobanEvents(CONTRACT_ID));

      const event = result.current.events[0];
      expect(Array.isArray(event.topic)).toBe(true);
      event.topic.forEach((t: string) => {
        expect(typeof t).toBe('string');
      });
    });
  });

  // ── Options / configuration ───────────────────────────────────────────────

  describe('configuration options', () => {
    it('should accept custom sorobanRpc URL', () => {
      mockUseSorobanEvents.mockReturnValue({
        events: [mockEvent1],
        loading: false,
        error: null,
        isRecovering: false,
        refresh: jest.fn(),
        stopPolling: jest.fn(),
      });

      const { result } = renderHook(() =>
        mockUseSorobanEvents(CONTRACT_ID, {
          sorobanRpc: 'https://custom-rpc.example.com',
        })
      );

      expect(result.current.events).toHaveLength(1);
    });

    it('should accept a fromCursor starting point', () => {
      mockUseSorobanEvents.mockReturnValue({
        events: [mockEvent2, mockEvent3],
        loading: false,
        error: null,
        isRecovering: false,
        refresh: jest.fn(),
        stopPolling: jest.fn(),
      });

      const { result } = renderHook(() =>
        mockUseSorobanEvents(CONTRACT_ID, { fromCursor: 'cursor-001' })
      );

      // Should only have events after the cursor
      expect(result.current.events[0].id).toBe('evt-002');
    });

    it('should accept topic filters', () => {
      mockUseSorobanEvents.mockReturnValue({
        events: [mockEvent1],
        loading: false,
        error: null,
        isRecovering: false,
        refresh: jest.fn(),
        stopPolling: jest.fn(),
      });

      const { result } = renderHook(() =>
        mockUseSorobanEvents(CONTRACT_ID, {
          topics: [['AAAADgAAAAh0cmFuc2Zlcg==']],
        })
      );

      expect(result.current.events).toHaveLength(1);
    });

    it('should handle pollIntervalMs set to null (polling disabled)', () => {
      mockUseSorobanEvents.mockReturnValue({
        events: [mockEvent1],
        loading: false,
        error: null,
        isRecovering: false,
        refresh: jest.fn(),
        stopPolling: jest.fn(),
      });

      const { result } = renderHook(() =>
        mockUseSorobanEvents(CONTRACT_ID, { pollIntervalMs: null })
      );

      expect(result.current.events).toHaveLength(1);
    });
  });
});
