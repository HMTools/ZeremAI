// The shape of an zeremai `flow.json`, as far as the hooks read it.

export type StepView = { name?: string; operationIds?: string[]; mockData?: Record<string, Record<string, unknown>> }
export type Step = {
  id?: string; number?: number | string; name?: string; status?: string; approvalRequired?: boolean; approved?: boolean; view?: StepView
  stepDefinition?: { output?: { description?: string; artifacts?: string[] } }
}
export type Flow = { status?: string; steps?: Step[]; currentState?: { activeStep?: { id?: string } }; metadata?: { lastUpdated?: string } }
