import { createRoot } from 'react-dom/client'
import Phone from './Phone.jsx'
import Viewer from './Viewer.jsx'
import './style.css'

const isPhone = new URLSearchParams(location.search).get('role') === 'phone'

createRoot(document.getElementById('root')).render(isPhone ? <Phone /> : <Viewer />)
