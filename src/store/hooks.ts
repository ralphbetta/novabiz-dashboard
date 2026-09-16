import { useDispatch, useSelector } from 'react-redux'
import type { AppDispatch, RootState } from './index'

/** Select narrowly: `useAppSelector(s => s.x.field)`, never a whole slice (ADR-0004). */
export const useAppDispatch = useDispatch.withTypes<AppDispatch>()
export const useAppSelector = useSelector.withTypes<RootState>()
