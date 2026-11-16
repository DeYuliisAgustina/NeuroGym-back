import { GrupoPermisos, Permiso, Rol } from '../../src/patterns/composite';

describe('Patrón Composite: permisos administrativos', () => {
  it('una hoja de GESTION habilita también la CONSULTA del mismo módulo', () => {
    const gestion = new Permiso('COBROS', 'GESTION');
    expect(gestion.permite('COBROS', 'CONSULTA')).toBe(true);
    expect(gestion.permite('COBROS', 'GESTION')).toBe(true);
    expect(gestion.permite('SOCIOS', 'CONSULTA')).toBe(false);
  });

  it('una hoja de CONSULTA no habilita GESTION', () => {
    expect(new Permiso('SOCIOS', 'CONSULTA').permite('SOCIOS', 'GESTION')).toBe(false);
  });

  it('el grupo delega en sus hijos y admite subgrupos', () => {
    const recepcion = new GrupoPermisos('RECEPCION').agregar(new Permiso('RECEPCION', 'CONSULTA'));
    const total = new GrupoPermisos('OPERACION').agregar(recepcion).agregar(new Permiso('COBROS', 'GESTION'));
    expect(total.permite('RECEPCION', 'CONSULTA')).toBe(true);
    expect(total.permite('COBROS', 'CONSULTA')).toBe(true);
    expect(total.permite('RECEPCION', 'GESTION')).toBe(false);
  });

  it('quitar un componente revoca el acceso', () => {
    const permiso = new Permiso('EQUIPAMIENTO', 'GESTION');
    const grupo = new GrupoPermisos('EQUIPAMIENTO').agregar(permiso);
    grupo.quitar(permiso);
    expect(grupo.permite('EQUIPAMIENTO', 'CONSULTA')).toBe(false);
  });

  it('Rol.desdePersistencia agrupa los permisos por módulo', () => {
    const rol = Rol.desdePersistencia({
      nombre: 'Recepción',
      esPrincipal: false,
      permisos: [
        { permiso: { acceso: 'GESTION', modulo: { codigo: 'RECEPCION' } } },
        { permiso: { acceso: 'CONSULTA', modulo: { codigo: 'SOCIOS' } } },
      ],
    });
    expect(rol.getComponentes()).toHaveLength(2);
    expect(rol.getComponentes().every((c) => c instanceof GrupoPermisos)).toBe(true);
    expect(rol.tienePermiso('RECEPCION', 'GESTION')).toBe(true);
    expect(rol.tienePermiso('SOCIOS', 'CONSULTA')).toBe(true);
    expect(rol.tienePermiso('SOCIOS', 'GESTION')).toBe(false);
    expect(rol.tienePermiso('COBROS', 'CONSULTA')).toBe(false);
  });

  it('el rol principal (administrador general) accede a todo el catálogo', () => {
    const rol = Rol.desdePersistencia({ nombre: 'Administrador general', esPrincipal: true, permisos: [] }, ['SOCIOS', 'COBROS', 'USUARIOS']);
    expect(rol.tienePermiso('USUARIOS', 'GESTION')).toBe(true);
    expect(rol.tienePermiso('COBROS', 'CONSULTA')).toBe(true);
    expect(rol.tienePermiso('INTELLIGENCE', 'CONSULTA')).toBe(false);
  });
});
